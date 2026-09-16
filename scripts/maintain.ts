import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { transaction, type Transaction } from '../src/lib/db';

export interface OwnerScope { ownerIds: readonly string[] }
export interface MaintenanceOptions extends OwnerScope { messageRetentionDays?: number }

function validateScope(values: readonly string[]): string[] {
  if (!values.length || values.length > 1000 || values.some((value) => typeof value !== 'string' || !value || value.length > 200)) {
    throw new Error('Supply an explicit nonempty owner scope.');
  }
  return [...new Set(values)].sort();
}

async function ownerWork<T>(database: Pool, scope: readonly string[] | null, work: (client: Transaction, owners: string[]) => Promise<T>): Promise<T> {
  const requested = scope === null ? null : validateScope(scope);
  return transaction(database, async (client) => {
    const rows = await client.query<{ owner_id: string }>(
      'SELECT owner_id FROM bridge_owner_state WHERE ($1::text[] IS NULL OR owner_id=ANY($1)) ORDER BY owner_id FOR UPDATE', [requested],
    );
    const owners = rows.rows.map((row) => row.owner_id);
    if (requested && owners.length !== requested.length) throw new Error('Owner scope is not available. No maintenance was performed.');
    return work(client, owners);
  });
}

async function maintenance(client: Transaction, owners: string[], days: number, allOwners: boolean) {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Retention must be 1 to 3650 days.');
  // Whole conversation context survives any unfinished work or unknown cleanup.
  // Delete only a contiguous prefix, so retained_after cannot hide newer holes.
  const messages = await client.query<{ removed: string; retired: string; conversations: string }>(`
    WITH eligible AS (
      SELECT c.id, COALESCE((SELECT min(m.sequence) FROM bridge_messages m WHERE m.conversation_id=c.id
        AND (m.acknowledged_at IS NULL OR m.created_at>=now()-$2*interval '1 day')),c.next_sequence) AS keep_from
      FROM bridge_conversations c JOIN bridge_projects p ON p.id=c.project_id
      WHERE p.owner_id=ANY($1::text[])
        AND NOT EXISTS(SELECT 1 FROM bridge_messages m WHERE m.conversation_id=c.id AND m.acknowledged_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM bridge_tasks t WHERE t.conversation_id=c.id AND t.state NOT IN ('completed','failed','cancelled'))
        AND NOT EXISTS(SELECT 1 FROM bridge_transfers t WHERE t.conversation_id=c.id AND
          (t.state NOT IN ('verified','failed','expired','cancelled') OR t.cleanup_state<>'confirmed'
           OR EXISTS(SELECT 1 FROM bridge_offers o WHERE o.transfer_id=t.id AND
             (o.cleanup_state<>'confirmed' OR (o.revoked_at IS NULL AND o.expires_at>now())))))
    ), removed AS (
      DELETE FROM bridge_messages m USING eligible e WHERE m.conversation_id=e.id AND m.sequence<e.keep_from
        AND m.acknowledged_at IS NOT NULL AND m.created_at<now()-$2*interval '1 day'
      RETURNING m.id,m.conversation_id,m.sequence
    ), retired AS (
      UPDATE bridge_idempotency i SET response='{}'::jsonb,retired=true
      WHERE NOT i.retired AND (i.actor_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM bridge_agents a JOIN bridge_projects p ON p.id=a.project_id
        WHERE a.id::text=i.actor_id AND p.owner_id=ANY($1::text[])))
        AND EXISTS(SELECT 1 FROM removed r WHERE position(r.id::text in i.response::text)>0)
      RETURNING i.actor_id
    ), gaps AS (
      UPDATE bridge_conversations c SET retained_after=GREATEST(c.retained_after,r.through_sequence)
      FROM (SELECT conversation_id,max(sequence) AS through_sequence FROM removed GROUP BY conversation_id) r
      WHERE c.id=r.conversation_id RETURNING c.id
    ) SELECT (SELECT count(*) FROM removed) AS removed,(SELECT count(*) FROM retired) AS retired,
      (SELECT count(*) FROM gaps) AS conversations`, [owners, days]);
  const envelopes = await client.query(`UPDATE bridge_offers o SET envelope=NULL FROM bridge_transfers t,bridge_projects p
    WHERE o.transfer_id=t.id AND t.project_id=p.id AND p.owner_id=ANY($1::text[]) AND o.envelope IS NOT NULL
      AND (o.expires_at<=now() OR o.revoked_at IS NOT NULL)`, [owners]);
  await client.query(`UPDATE bridge_credentials k SET kit_envelope=NULL FROM bridge_agents a,bridge_projects p
    WHERE k.agent_id=a.id AND a.project_id=p.id AND p.owner_id=ANY($1::text[]) AND k.kit_envelope IS NOT NULL
      AND (k.expires_at<=now() OR k.revoked_at IS NOT NULL)`,[owners]);
  const rates = await client.query(`DELETE FROM bridge_rate_windows r WHERE r.window_start < floor(extract(epoch FROM now())/60)-1440
    AND (($2::boolean AND r.actor_id='anonymous') OR EXISTS(SELECT 1 FROM bridge_agents a JOIN bridge_projects p ON p.id=a.project_id
      WHERE a.id::text=r.actor_id AND p.owner_id=ANY($1::text[])))`, [owners, allOwners]);
  const audits = await client.query("DELETE FROM bridge_audit WHERE owner_id=ANY($1::text[]) AND created_at<now()-interval '365 days'", [owners]);
  for (const owner of owners) {
    await client.query("INSERT INTO bridge_audit(owner_id,actor_id,action) VALUES($1,'local-maintenance','maintenance.retention')", [owner]);
  }
  const result = messages.rows[0];
  return { owners: owners.length, messages_removed: Number(result.removed), conversations_with_gap: Number(result.conversations),
    idempotency_retired: Number(result.retired), envelopes_purged: envelopes.rowCount ?? 0,
    rate_windows_removed: rates.rowCount ?? 0, audit_events_removed: audits.rowCount ?? 0 };
}

export function maintainOwners(database: Pool, options: MaintenanceOptions) {
  return ownerWork(database, options.ownerIds, (client, owners) => maintenance(client, owners, options.messageRetentionDays ?? 90, false));
}

export function maintainAllOwners(database: Pool, options: { confirm: 'ALL_OWNERS'; messageRetentionDays?: number }) {
  if (options.confirm !== 'ALL_OWNERS') throw new Error('Explicit global maintenance confirmation is required.');
  return ownerWork(database, null, (client, owners) => maintenance(client, owners, options.messageRetentionDays ?? 90, true));
}

/** Called inside the same owner-locked transaction as local recovery. No network authentication bypass. */
export async function invalidateOwnerAccess(client: Transaction, owners: readonly string[], reason: 'restore' | 'password-recovery') {
  const credentials = await client.query(`UPDATE bridge_credentials k SET revoked_at=COALESCE(k.revoked_at,now())
    FROM bridge_agents a,bridge_projects p WHERE k.agent_id=a.id AND a.project_id=p.id AND p.owner_id=ANY($1::text[])`, [owners]);
  const agents = await client.query(`UPDATE bridge_agents a SET session_id=NULL,takeover_digest=NULL,generation=generation+1
    FROM bridge_projects p WHERE a.project_id=p.id AND p.owner_id=ANY($1::text[])`, [owners]);
  const offers = await client.query(`UPDATE bridge_offers o SET envelope=NULL,revoked_at=COALESCE(o.revoked_at,now()),expires_at=LEAST(o.expires_at,now()),
    cleanup_state=CASE WHEN o.cleanup_state='confirmed' THEN 'confirmed' ELSE 'unknown' END
    FROM bridge_transfers t,bridge_projects p WHERE o.transfer_id=t.id AND t.project_id=p.id AND p.owner_id=ANY($1::text[])`, [owners]);
  const transfers = await client.query(`UPDATE bridge_transfers t SET
    state=CASE WHEN t.state IN ('requested','offered','in_progress','awaiting_verification') THEN 'expired' ELSE t.state END,
    cleanup_state=CASE WHEN t.cleanup_state='confirmed' THEN 'confirmed' ELSE 'unknown' END
    FROM bridge_projects p WHERE t.project_id=p.id AND p.owner_id=ANY($1::text[])`, [owners]);
  const tasks = await client.query(`UPDATE bridge_tasks t SET
    cancellation_requested=(t.cancellation_requested OR t.state='cancel_requested'),state='needs_reconciliation',updated_at=now()
    FROM bridge_projects p WHERE t.project_id=p.id AND p.owner_id=ANY($1::text[]) AND t.state NOT IN ('completed','failed','cancelled')`, [owners]);
  const projects = await client.query("UPDATE bridge_projects SET state='paused' WHERE owner_id=ANY($1::text[]) AND state<>'archived'", [owners]);
  const sessions = await client.query('DELETE FROM "session" WHERE "userId"=ANY($1::text[])', [owners]);
  // Legacy twoFactor records store the owner ID as the challenge value.
  // Remove dependent attempt/OTP keys without touching another owner's records.
  const challenges = await client.query<{ identifier: string }>('SELECT identifier FROM verification WHERE value=ANY($1::text[])', [owners]);
  const dependent = challenges.rows.flatMap(({ identifier }) => [`2fa-attempts-${identifier}`, `2fa-otp-${identifier}`]);
  dependent.push(...owners.map((owner) => `2fa-otp-${owner}`));
  const verification = await client.query('DELETE FROM verification WHERE value=ANY($1::text[]) OR identifier=ANY($2::text[])', [owners, dependent]);
  const retired = await client.query(`UPDATE bridge_idempotency i SET response='{}'::jsonb,retired=true
    WHERE NOT i.retired AND (i.actor_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM bridge_agents a JOIN bridge_projects p ON p.id=a.project_id
      WHERE a.id::text=i.actor_id AND p.owner_id=ANY($1::text[])))`, [owners]);
  for (const owner of owners) {
    await client.query('INSERT INTO bridge_audit(owner_id,actor_id,action) VALUES($1,$2,$3)', [owner, 'local-recovery', `recovery.${reason}`]);
  }
  return { owners: owners.length, credentials_revoked: credentials.rowCount ?? 0, agent_sessions_fenced: agents.rowCount ?? 0,
    offers_expired: offers.rowCount ?? 0, transfers_checked: transfers.rowCount ?? 0, tasks_requiring_reconciliation: tasks.rowCount ?? 0,
    projects_paused: projects.rowCount ?? 0, human_sessions_removed: sessions.rowCount ?? 0,
    verification_records_removed: verification.rowCount ?? 0, idempotency_retired: retired.rowCount ?? 0 };
}

export function prepareOwnerRestore(database: Pool, scope: OwnerScope) {
  return ownerWork(database, scope.ownerIds, (client, owners) => invalidateOwnerAccess(client, owners, 'restore'));
}

export function prepareGlobalRestore(database: Pool, options: { confirm: 'DISABLE_RESTORED_ACCESS' }) {
  if (options.confirm !== 'DISABLE_RESTORED_ACCESS') throw new Error('Explicit restored-access invalidation confirmation is required.');
  return ownerWork(database, null, async (client, owners) => {
    const report = await invalidateOwnerAccess(client, owners, 'restore');
    // Only this explicit global operation can touch non-owner auth remnants.
    const remainingSessions = await client.query('DELETE FROM "session"');
    const remainingVerification = await client.query('DELETE FROM verification');
    return { ...report, human_sessions_removed: report.human_sessions_removed + (remainingSessions.rowCount ?? 0),
      verification_records_removed: report.verification_records_removed + (remainingVerification.rowCount ?? 0) };
  });
}

async function main() {
  if (process.argv.length > 2 || !process.env.DATABASE_URL) throw new Error('Use explicit environment settings; command-line arguments are not accepted.');
  const action = process.env.BRIDGE_MAINTENANCE_ACTION;
  const scope = process.env.BRIDGE_MAINTENANCE_SCOPE;
  if (!['retention', 'prepare-restore'].includes(action ?? '') || !['owners', 'all'].includes(scope ?? '')) throw new Error('Explicit action and scope are required.');
  const owners = scope === 'owners' ? validateScope((process.env.BRIDGE_OWNER_IDS ?? '').split(',').map((value) => value.trim())) : null;
  if (action === 'prepare-restore' && process.env.BRIDGE_CONFIRM_RESTORE !== 'DISABLE_RESTORED_ACCESS') throw new Error('Restore confirmation is required.');
  const database = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const result = action === 'retention'
      ? owners ? await maintainOwners(database, { ownerIds: owners }) : await maintainAllOwners(database, { confirm: 'ALL_OWNERS' })
      : owners ? await prepareOwnerRestore(database, { ownerIds: owners }) : await prepareGlobalRestore(database, { confirm: 'DISABLE_RESTORED_ACCESS' });
    process.stdout.write(`${JSON.stringify({ action, scope, ...result })}\n`);
  } finally { await database.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Maintenance failed. Check explicit action/scope, applied migrations, and database access. No connection details or records were printed.');
    process.exitCode = 1;
  });
}
