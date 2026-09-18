import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { transaction, type Transaction } from './db';
import {validateDevice,verifyProof,type RequestProof} from './request-proof';
import { fail } from './protocol';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type AgentIdentity = { id: string; name: string; owner_id: string; project_id: string; environment_id: string;
  role: 'development' | 'deployment'; generation: number; session_id: string | null; project_state: string; credential_id: string };
export type AgentAccess = { token: string; session?: string | null; proof?:RequestProof; enrollment?:boolean };
export function accessFrom(request: Request): AgentAccess {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) fail(401,'UNAUTHORIZED','A valid agent credential is required.');
  return { token: authorization.slice(7), session: request.headers.get('X-Bridge-Session') };
}
export function newCredential() {
  const id = randomUUID();
  const token = `oab_${id}.${randomBytes(32).toString('base64url')}`;
  return { id, token, digest: digest(token) };
}

export async function authenticate(client: Transaction, access: AgentAccess, requireSession = true): Promise<AgentIdentity> {
  const match = /^oab_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(access.token);
  if (!match || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(match[1])) fail(401,'UNAUTHORIZED','A valid agent credential is required.');
  const lookup = await client.query(`SELECT p.owner_id FROM bridge_credentials k JOIN bridge_agents a ON a.id=k.agent_id
    JOIN bridge_projects p ON p.id=a.project_id WHERE k.id=$1`, [match[1]]);
  if (!lookup.rowCount) fail(401,'UNAUTHORIZED','A valid agent credential is required.');
  // All operations for an owner share this serialization boundary, including
  // credential revocation, suspension, pairing changes and session takeover.
  const owner = await client.query('SELECT active FROM bridge_owner_state WHERE owner_id=$1 FOR UPDATE', [lookup.rows[0].owner_id]);
  if (!owner.rows[0]?.active) fail(401,'UNAUTHORIZED','A valid agent credential is required.');
  const result = await client.query(`SELECT a.*,p.owner_id,p.state AS project_state,k.id AS credential_id,k.digest,
    k.expires_at,k.revoked_at,k.enrollment_expires_at,k.public_key,k.device_binding FROM bridge_credentials k JOIN bridge_agents a ON a.id=k.agent_id
    JOIN bridge_projects p ON p.id=a.project_id WHERE k.id=$1`, [match[1]]);
  const row = result.rows[0];
  const actual = Buffer.from(digest(access.token), 'hex');
  if (!row || !row.active || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()
    || row.project_state === 'archived' || !timingSafeEqual(actual, Buffer.from(row.digest, 'hex'))) fail(401,'UNAUTHORIZED','A valid agent credential is required.');
  if(row.enrollment_expires_at&&!row.public_key&&!access.enrollment)fail(401,'ENROLLMENT_REQUIRED','Claim the setup with a locally generated key first.');
  if(row.key_bound&&!row.public_key&&!access.enrollment)fail(401,'KEY_PROOF_REQUIRED','This agent uses key-bound access.');
  if(row.device_binding&&validateDevice(access.proof?.device)!==row.device_binding)fail(403,'DEVICE_MISMATCH','This device does not match enrollment. Ask an administrator to replace access.');
  if(row.public_key)await verifyProof(client,row.credential_id,row.public_key,access.token,access.session,access.proof);
  if (requireSession && (!access.session || row.session_id !== access.session)) fail(409,'SESSION_CONFLICT','Start a session or ask the owner to authorize takeover.');
  await client.query('UPDATE bridge_agents SET last_seen_at=now() WHERE id=$1',[row.id]);
  return row as AgentIdentity;
}
export async function agentTransaction<T>(database: Pool, access: AgentAccess,
  work: (client: Transaction, identity: AgentIdentity) => Promise<T>, session = true): Promise<T> {
  return transaction(database, async client => work(client, await authenticate(client, access, session)));
}
export async function recordAttempt(database:Pool,token:string) {
  // Admission is committed independently of the requested operation. Invalid
  // payloads and inaccessible-resource probes still consume the request budget.
  const candidate=/^oab_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./.exec(token);
  let actor='anonymous';
  if(candidate) {
    const known=await database.query('SELECT agent_id,digest FROM bridge_credentials WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()',[candidate[1]]);
    // A public credential identifier cannot spend another agent's quota.
    // Retired keys cannot exhaust the replacement key's shared agent budget.
    // Full authorization still happens inside the serialized transaction.
    if(known.rowCount&&timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(known.rows[0].digest,'hex')))actor=known.rows[0].agent_id;
  }
  const window=Math.floor(Date.now()/60000);
  const rate=await database.query(`INSERT INTO bridge_rate_windows(actor_id,window_start,count) VALUES($1,$2,1)
    ON CONFLICT(actor_id,window_start) DO UPDATE SET count=bridge_rate_windows.count+1 RETURNING count`,[actor,window]);
  if(rate.rows[0].count>(actor==='anonymous'?60:240))fail(429,'RATE_LIMITED','Request limit reached.');
}
export async function audit(client: Transaction, identity: { owner_id: string; project_id?: string; id: string }, action: string, resource?: string) {
  await client.query('INSERT INTO bridge_audit(owner_id,project_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)',
    [identity.owner_id,identity.project_id ?? null,identity.id,action,resource ?? null]);
}
