import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maintainOwners, prepareOwnerRestore } from '../scripts/maintain';
import { recoverOwner } from '../scripts/recover-owner';
import { newCredential } from '../src/lib/agent-auth';
import { idempotent } from '../src/lib/messaging';
import { transaction } from '../src/lib/db';

type OwnerFixture = { id: string; email: string; project: string; environment: string; oldPassword: string };
type Pair = { conversation: string; dev: string; deploy: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

describe.skipIf(!process.env.TEST_DATABASE_URL)('owner-scoped maintenance and recovery', () => {
  let database: Pool;
  let owner: OwnerFixture, other: OwnerFixture;
  const owners: OwnerFixture[] = [];
  const verificationIds: string[] = [];

  async function makeOwner(): Promise<OwnerFixture> {
    const value = { id: randomUUID(), email: `ops-${randomUUID()}@example.test`, project: randomUUID(), environment: randomUUID(), oldPassword: randomBytes(24).toString('base64url') };
    owners.push(value);
    await database.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt","twoFactorEnabled") VALUES($1,$2,$3,true,now(),now(),true)', [value.id, 'Synthetic ops owner', value.email]);
    await database.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)', [value.id]);
    await database.query('INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())', [randomUUID(), value.id, await hashPassword(value.oldPassword)]);
    await database.query('INSERT INTO bridge_projects(id,owner_id,name,client_label) VALUES($1,$2,$3,$4)', [value.project, value.id, 'Ops test', 'Synthetic only']);
    await database.query('INSERT INTO bridge_environments(id,project_id,name) VALUES($1,$2,$3)', [value.environment, value.project, 'Disposable']);
    return value;
  }

  async function makePair(who: OwnerFixture): Promise<Pair> {
    const pair = { conversation: randomUUID(), dev: randomUUID(), deploy: randomUUID() };
    for (const [id, role] of [[pair.dev, 'development'], [pair.deploy, 'deployment']]) {
      await database.query('INSERT INTO bridge_agents(id,project_id,environment_id,name,role,session_id,generation,takeover_digest) VALUES($1,$2,$3,$4,$5,$6,3,$7)', [id, who.project, who.environment, 'Synthetic agent', role, randomUUID(), digest('synthetic takeover')]);
    }
    const [a, b] = [pair.dev, pair.deploy].sort();
    await database.query('INSERT INTO bridge_pairings(project_id,environment_id,agent_a,agent_b) VALUES($1,$2,$3,$4)', [who.project, who.environment, a, b]);
    await database.query('INSERT INTO bridge_conversations(id,project_id,environment_id,agent_a,agent_b) VALUES($1,$2,$3,$4,$5)', [pair.conversation, who.project, who.environment, a, b]);
    return pair;
  }

  async function message(who: OwnerFixture, pair: Pair, sequence: number, age = 100, ack = true) {
    const id = randomUUID();
    await database.query(`INSERT INTO bridge_messages(id,project_id,environment_id,conversation_id,sequence,sender_id,author_type,recipient_agent_id,type,body,created_at,acknowledged_at)
      VALUES($1,$2,$3,$4,$5,$6,'agent',$7,'note','Synthetic retained context',now()-$8*interval '1 day',CASE WHEN $9 THEN now() ELSE NULL END)`,
    [id, who.project, who.environment, pair.conversation, sequence, pair.dev, pair.deploy, age, ack]);
    await database.query('UPDATE bridge_conversations SET next_sequence=GREATEST(next_sequence,$2) WHERE id=$1', [pair.conversation, sequence + 1]);
    return id;
  }

  async function task(who: OwnerFixture, pair: Pair, state = 'claimed') {
    const id = randomUUID();
    await database.query(`INSERT INTO bridge_tasks(id,project_id,environment_id,conversation_id,requester_id,assignee_id,title,instructions,state,claim_generation,session_generation,lease_until,cancellation_requested)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic task','Do not execute',$7,1,3,now()+interval '1 hour',$8)`,
    [id, who.project, who.environment, pair.conversation, pair.dev, pair.deploy, state, state === 'cancel_requested']);
    return id;
  }

  async function transfer(who: OwnerFixture, pair: Pair, state = 'offered', cleanup = 'pending', expired = false) {
    const id = randomUUID(), offer = randomUUID();
    await database.query(`INSERT INTO bridge_transfers(id,project_id,environment_id,conversation_id,source_id,destination_id,host_id,direction,manifest,state,cleanup_state)
      VALUES($1,$2,$3,$4,$5,$6,$5,'download',$7,$8,$9)`,
    [id, who.project, who.environment, pair.conversation, pair.dev, pair.deploy, { filename: 'synthetic.bin', size: 1, sha256: digest('x') }, state, cleanup]);
    await database.query(`INSERT INTO bridge_offers(id,transfer_id,origin,envelope,expires_at,cleanup_state) VALUES($1,$2,'https://synthetic.example.invalid',$3,now()+$4*interval '1 hour',$5)`, [offer, id, { ciphertext: 'synthetic encrypted placeholder' }, expired ? -1 : 1, cleanup]);
    return { id, offer };
  }

  async function cache(actor: string, response: unknown, operation = 'ops-test') {
    const key = randomUUID();
    await database.query('INSERT INTO bridge_idempotency(actor_id,operation,key_digest,request_digest,response) VALUES($1,$2,$3,$4,$5)', [actor, operation, digest(key), digest('{}'), response]);
    return key;
  }

  async function authData(who: OwnerFixture, pair: Pair) {
    const credential = newCredential();
    await database.query('INSERT INTO bridge_credentials(id,agent_id,digest,expires_at) VALUES($1,$2,$3,now()+interval \'1 day\')', [credential.id, pair.dev, credential.digest]);
    const session = randomUUID(), challenge = `2fa-${randomUUID()}`, attempt = `2fa-attempts-${challenge}`;
    await database.query('INSERT INTO "session"(id,"expiresAt",token,"createdAt","updatedAt","userId","bridgeMfaVerified") VALUES($1,now()+interval \'1 day\',$2,now(),now(),$3,true)', [session, randomUUID(), who.id]);
    for (const [identifier, value] of [[challenge, who.id], [attempt, '0']]) {
      const id = randomUUID();
      verificationIds.push(id);
      await database.query('INSERT INTO verification(id,identifier,value,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now(),now())', [id, identifier, value]);
    }
    return { credential: credential.id, session, challenge, attempt };
  }

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55442' || url.pathname !== '/oab_test' || url.username !== 'oab_test') throw new Error('Only the isolated test database is permitted.');
    database = new Pool({ connectionString: url.toString(), max: 4 });
    const migration = await database.query("SELECT 1 FROM information_schema.columns WHERE table_name='bridge_idempotency' AND column_name='retired'");
    if (!migration.rowCount) throw new Error('Apply migration 004 transactionally with the migration runner before these tests.');
    owner = await makeOwner(); other = await makeOwner();
  });

  afterAll(async () => {
    if (!database) return;
    const ids = owners.map((who) => who.id), projects = owners.map((who) => who.project);
    const agents = (await database.query('SELECT id FROM bridge_agents WHERE project_id=ANY($1::uuid[])', [projects])).rows.map((row) => row.id);
    await database.query('DELETE FROM verification WHERE id=ANY($1::text[])', [verificationIds]);
    await database.query('DELETE FROM bridge_receipts WHERE transfer_id IN (SELECT id FROM bridge_transfers WHERE project_id=ANY($1::uuid[]))', [projects]);
    await database.query('DELETE FROM bridge_offers WHERE transfer_id IN (SELECT id FROM bridge_transfers WHERE project_id=ANY($1::uuid[]))', [projects]);
    for (const table of ['bridge_transfers', 'bridge_messages', 'bridge_tasks', 'bridge_conversations', 'bridge_pairings']) {
      await database.query(`DELETE FROM ${table} WHERE project_id=ANY($1::uuid[])`, [projects]);
    }
    await database.query('DELETE FROM bridge_recipient_keys WHERE agent_id=ANY($1::uuid[])', [agents]);
    await database.query('DELETE FROM bridge_credentials WHERE agent_id=ANY($1::uuid[])', [agents]);
    await database.query('DELETE FROM bridge_idempotency WHERE actor_id=ANY($1::text[])', [[...agents, ...ids]]);
    await database.query('DELETE FROM bridge_rate_windows WHERE actor_id=ANY($1::text[])', [agents]);
    await database.query('DELETE FROM bridge_agents WHERE project_id=ANY($1::uuid[])', [projects]);
    await database.query('DELETE FROM bridge_environments WHERE project_id=ANY($1::uuid[])', [projects]);
    await database.query('DELETE FROM bridge_audit WHERE owner_id=ANY($1::text[])', [ids]);
    await database.query('DELETE FROM bridge_projects WHERE owner_id=ANY($1::text[])', [ids]);
    await database.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [ids]);
    await database.end();
  });

  it('retires old acknowledged messages and cached copies only for the selected owner', async () => {
    const ownPair = await makePair(owner), otherPair = await makePair(other);
    const ownMessage = await message(owner, ownPair, 1), foreignMessage = await message(other, otherPair, 1);
    const key = await cache(ownPair.dev, { notification: { id: ownMessage, body: 'Synthetic expired content' } });
    await maintainOwners(database, { ownerIds: [owner.id] });
    expect((await database.query('SELECT id FROM bridge_messages WHERE id=$1', [ownMessage])).rowCount).toBe(0);
    expect((await database.query('SELECT id FROM bridge_messages WHERE id=$1', [foreignMessage])).rowCount).toBe(1);
    expect(Number((await database.query('SELECT retained_after FROM bridge_conversations WHERE id=$1', [ownPair.conversation])).rows[0].retained_after)).toBe(1);
    const cached = (await database.query('SELECT response,retired,request_digest FROM bridge_idempotency WHERE actor_id=$1 AND key_digest=$2', [ownPair.dev, digest(key)])).rows[0];
    expect(cached).toMatchObject({ response: {}, retired: true, request_digest: digest('{}') });
    await expect(transaction(database, (client) => idempotent(client, ownPair.dev, 'ops-test', key, {}, async () => ({ recreated: true })))).rejects.toMatchObject({ status: 410 });
  });

  it('preserves all context for pending delivery, unfinished task, active transfer or unresolved cleanup', async () => {
    const protectedMessages: string[] = [];
    for (const reason of ['delivery', 'task', 'transfer', 'cleanup']) {
      const pair = await makePair(owner);
      protectedMessages.push(await message(owner, pair, 1));
      if (reason === 'delivery') await message(owner, pair, 2, 0, false);
      if (reason === 'task') await task(owner, pair, 'awaiting_reply');
      if (reason === 'transfer') await transfer(owner, pair);
      if (reason === 'cleanup') await transfer(owner, pair, 'failed', 'unknown', true);
    }
    await maintainOwners(database, { ownerIds: [owner.id] });
    expect((await database.query('SELECT id FROM bridge_messages WHERE id=ANY($1::uuid[])', [protectedMessages])).rowCount).toBe(4);
  });

  it('scrubs owner-authored cached message responses when the retained message is removed', async () => {
    const pair = await makePair(owner);
    const id = await message(owner, pair, 1);
    await database.query("UPDATE bridge_messages SET author_type='owner',sender_id=NULL WHERE id=$1", [id]);
    const key = await cache(owner.id, { id, author_type: 'owner', body: 'Synthetic old owner instruction' }, 'admin/ops-test/messages');
    await maintainOwners(database, { ownerIds: [owner.id] });
    const cached = (await database.query('SELECT response,retired FROM bridge_idempotency WHERE actor_id=$1 AND key_digest=$2', [owner.id, digest(key)])).rows[0];
    expect(cached).toEqual({ response: {}, retired: true });
    expect((await database.query('SELECT id FROM bridge_messages WHERE id=$1', [id])).rowCount).toBe(0);
  });

  it('retains history for an expired historical endpoint until its own cleanup is confirmed', async () => {
    const pair=await makePair(owner),id=await message(owner,pair,1);
    const finished=await transfer(owner,pair,'verified','confirmed',true);
    const historical=randomUUID();
    await database.query("INSERT INTO bridge_offers(id,transfer_id,origin,envelope,expires_at,revoked_at,cleanup_state) VALUES($1,$2,'https://historical.example.invalid',NULL,now()-interval '1 day',now()-interval '1 day','unknown')",[historical,finished.id]);
    await maintainOwners(database,{ownerIds:[owner.id]});
    expect((await database.query('SELECT id FROM bridge_messages WHERE id=$1',[id])).rowCount).toBe(1);
    await database.query("UPDATE bridge_offers SET cleanup_state='confirmed' WHERE id=$1",[historical]);
    await maintainOwners(database,{ownerIds:[owner.id]});
    expect((await database.query('SELECT id FROM bridge_messages WHERE id=$1',[id])).rowCount).toBe(0);
  });

  it('advances only a contiguous retention prefix despite out-of-order timestamps', async () => {
    const pair = await makePair(owner);
    const first = await message(owner, pair, 1), recent = await message(owner, pair, 2, 1), oldAfterRecent = await message(owner, pair, 3);
    await maintainOwners(database, { ownerIds: [owner.id] });
    const remaining = (await database.query('SELECT id FROM bridge_messages WHERE conversation_id=$1 ORDER BY sequence', [pair.conversation])).rows.map((row) => row.id);
    expect(remaining).toEqual([recent, oldAfterRecent]);
    expect(remaining).not.toContain(first);
    expect(Number((await database.query('SELECT retained_after FROM bridge_conversations WHERE id=$1', [pair.conversation])).rows[0].retained_after)).toBe(1);
  });

  it('purges expired envelopes, old rate windows and old audit without crossing owner scope', async () => {
    const pair = await makePair(owner), foreign = await makePair(other);
    const ownTransfer = await transfer(owner, pair, 'offered', 'pending', true), foreignTransfer = await transfer(other, foreign, 'offered', 'pending', true);
    for (const [who, actor] of [[owner, pair.dev], [other, foreign.dev]] as const) {
      await database.query("INSERT INTO bridge_audit(owner_id,actor_id,action,created_at) VALUES($1,$2,'synthetic-old',now()-interval '400 days')", [who.id, actor]);
      await database.query('INSERT INTO bridge_rate_windows(actor_id,window_start,count) VALUES($1,1,1)', [actor]);
    }
    await maintainOwners(database, { ownerIds: [owner.id] });
    expect((await database.query('SELECT envelope FROM bridge_offers WHERE id=$1', [ownTransfer.offer])).rows[0].envelope).toBeNull();
    expect((await database.query('SELECT envelope FROM bridge_offers WHERE id=$1', [foreignTransfer.offer])).rows[0].envelope).not.toBeNull();
    expect((await database.query("SELECT id FROM bridge_audit WHERE owner_id=$1 AND action='synthetic-old'", [owner.id])).rowCount).toBe(0);
    expect((await database.query("SELECT id FROM bridge_audit WHERE owner_id=$1 AND action='synthetic-old'", [other.id])).rowCount).toBe(1);
    expect((await database.query('SELECT count FROM bridge_rate_windows WHERE actor_id=$1', [pair.dev])).rowCount).toBe(0);
    expect((await database.query('SELECT count FROM bridge_rate_windows WHERE actor_id=$1', [foreign.dev])).rowCount).toBe(1);
  });

  it('invalidates restored access and forces reconciliation only within the selected owner', async () => {
    const pair = await makePair(owner), foreignPair = await makePair(other);
    const ownAuth = await authData(owner, pair), foreignAuth = await authData(other, foreignPair);
    const pending = await task(owner, pair, 'pending'), cancelled = await task(owner, pair, 'cancel_requested'), terminal = await task(owner, pair, 'completed');
    const active = await transfer(owner, pair);
    await cache(pair.dev, { old_session: randomUUID() });
    const ownerCache = await cache(owner.id, { synthetic_owner_operation: 'old state' }, 'admin/ops-test/cancel');
    const foreignCache = await cache(other.id, { synthetic_owner_operation: 'still valid' }, 'admin/ops-test/cancel');
    await prepareOwnerRestore(database, { ownerIds: [owner.id] });
    expect((await database.query('SELECT revoked_at FROM bridge_credentials WHERE id=$1', [ownAuth.credential])).rows[0].revoked_at).not.toBeNull();
    expect((await database.query('SELECT revoked_at FROM bridge_credentials WHERE id=$1', [foreignAuth.credential])).rows[0].revoked_at).toBeNull();
    expect((await database.query('SELECT session_id,takeover_digest,generation FROM bridge_agents WHERE id=$1', [pair.dev])).rows[0]).toMatchObject({ session_id: null, takeover_digest: null, generation: 4 });
    expect((await database.query('SELECT state FROM bridge_projects WHERE id=$1', [owner.project])).rows[0].state).toBe('paused');
    expect((await database.query('SELECT state FROM bridge_projects WHERE id=$1', [other.project])).rows[0].state).toBe('active');
    expect((await database.query('SELECT id FROM "session" WHERE id=$1', [ownAuth.session])).rowCount).toBe(0);
    expect((await database.query('SELECT id FROM "session" WHERE id=$1', [foreignAuth.session])).rowCount).toBe(1);
    expect((await database.query('SELECT id FROM verification WHERE identifier=ANY($1::text[])', [[ownAuth.challenge, ownAuth.attempt]])).rowCount).toBe(0);
    expect((await database.query('SELECT state FROM bridge_tasks WHERE id=$1', [pending])).rows[0].state).toBe('needs_reconciliation');
    expect((await database.query('SELECT state,cancellation_requested FROM bridge_tasks WHERE id=$1', [cancelled])).rows[0]).toMatchObject({ state: 'needs_reconciliation', cancellation_requested: true });
    expect((await database.query('SELECT state FROM bridge_tasks WHERE id=$1', [terminal])).rows[0].state).toBe('completed');
    expect((await database.query('SELECT envelope,revoked_at FROM bridge_offers WHERE id=$1', [active.offer])).rows[0]).toMatchObject({ envelope: null });
    expect((await database.query('SELECT state,cleanup_state FROM bridge_transfers WHERE id=$1', [active.id])).rows[0]).toMatchObject({ state: 'expired', cleanup_state: 'unknown' });
    expect((await database.query('SELECT response,retired FROM bridge_idempotency WHERE actor_id=$1 AND key_digest=$2', [owner.id, digest(ownerCache)])).rows[0]).toEqual({ response: {}, retired: true });
    expect((await database.query('SELECT retired FROM bridge_idempotency WHERE actor_id=$1 AND key_digest=$2', [other.id, digest(foreignCache)])).rows[0].retired).toBe(false);
  });

  it('recovers an owner password with a new Better Auth hash, clears legacy MFA, and requires password sign-in', async () => {
    const selected = await makeOwner(), pair = await makePair(selected);
    const before = await authData(selected, pair);
    await database.query('INSERT INTO "twoFactor"(id,secret,"backupCodes","userId") VALUES($1,$2,$3,$4)', [randomUUID(), 'synthetic seed', 'synthetic codes', selected.id]);
    const password = randomBytes(24).toString('base64url');
    const result = await recoverOwner(database, { email: selected.email, password }, { ownerIds: [selected.id] });
    expect(result.password_signin_required).toBe(true);
    const stored = (await database.query('SELECT password FROM account WHERE "userId"=$1', [selected.id])).rows[0].password;
    expect(await verifyPassword({ hash: stored, password })).toBe(true);
    expect(await verifyPassword({ hash: stored, password: selected.oldPassword })).toBe(false);
    expect((await database.query('SELECT "twoFactorEnabled" FROM "user" WHERE id=$1', [selected.id])).rows[0].twoFactorEnabled).toBe(false);
    expect((await database.query('SELECT id FROM "twoFactor" WHERE "userId"=$1', [selected.id])).rowCount).toBe(0);
    expect((await database.query('SELECT id FROM "session" WHERE id=$1', [before.session])).rowCount).toBe(0);
    expect((await database.query("SELECT id FROM bridge_audit WHERE owner_id=$1 AND action='recovery.password-recovery'", [selected.id])).rowCount).toBe(1);
  });

  it('fails closed for wrong owner scope and invalid recovery passwords', async () => {
    const original = (await database.query('SELECT password FROM account WHERE "userId"=$1', [other.id])).rows[0].password;
    await expect(maintainOwners(database, { ownerIds: [] })).rejects.toThrow();
    await expect(prepareOwnerRestore(database, { ownerIds: [randomUUID()] })).rejects.toThrow();
    await expect(recoverOwner(database, { email: other.email, password: 'A-valid-long-synthetic-password' }, { ownerIds: [owner.id] })).rejects.toThrow();
    await expect(recoverOwner(database, { email: other.email, password: 'short' }, { ownerIds: [other.id] })).rejects.toThrow();
    expect((await database.query('SELECT password FROM account WHERE "userId"=$1', [other.id])).rows[0].password).toBe(original);
  });

  it('rolls back password writes when recovery finds an ambiguous credential account', async () => {
    const selected = await makeOwner(), pair = await makePair(selected);
    const before = await authData(selected, pair);
    const oldHash = (await database.query('SELECT password FROM account WHERE "userId"=$1', [selected.id])).rows[0].password;
    await database.query('INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$3,$4,now(),now())', [randomUUID(), randomUUID(), selected.id, oldHash]);
    await expect(recoverOwner(database, { email: selected.email, password: 'Another-valid-synthetic-password' }, { ownerIds: [selected.id] })).rejects.toThrow();
    const hashes = (await database.query('SELECT password FROM account WHERE "userId"=$1', [selected.id])).rows.map((row) => row.password);
    expect(hashes.every((hash) => hash === oldHash)).toBe(true);
    expect((await database.query('SELECT id FROM "session" WHERE id=$1', [before.session])).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM bridge_audit WHERE owner_id=$1 AND action='recovery.password-recovery'", [selected.id])).rowCount).toBe(0);
  });
});
