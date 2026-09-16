import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import { Pool } from 'pg';
import { transaction } from '../src/lib/db';
import { invalidateOwnerAccess } from './maintain';

export interface RecoverOwnerInput { email: string; password: string }

/** Local administrative recovery only. Stop the web application before invoking. */
export async function recoverOwner(database: Pool, input: RecoverOwnerInput, scope: { ownerIds?: readonly string[] } = {}) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || input.password.length < 16 || input.password.length > 128) {
    throw new Error('Use a valid owner email and a password of 16 to 128 characters.');
  }
  if (scope.ownerIds && (!scope.ownerIds.length || scope.ownerIds.some((id) => !id || id.length > 200))) throw new Error('Recovery scope is invalid.');
  const passwordHash = await hashPassword(input.password);
  return transaction(database, async (client) => {
    const owner = await client.query<{ id: string; active: boolean }>(`SELECT u.id,o.active FROM "user" u JOIN bridge_owner_state o ON o.owner_id=u.id
      WHERE lower(u.email)=$1 AND ($2::text[] IS NULL OR u.id=ANY($2)) ORDER BY u.id FOR UPDATE OF o`, [email, scope.ownerIds ?? null]);
    if (owner.rowCount !== 1) throw new Error('The requested owner is not available. No recovery was performed.');
    const id = owner.rows[0].id;
    const account = await client.query(`UPDATE account SET password=$2,"updatedAt"=now()
      WHERE "userId"=$1 AND "providerId"='credential' RETURNING id`, [id, passwordHash]);
    if (account.rowCount !== 1) throw new Error('Expected one local password account. No recovery was performed.');
    const result = await invalidateOwnerAccess(client, [id], 'password-recovery');
    await client.query('DELETE FROM "twoFactor" WHERE "userId"=$1', [id]);
    await client.query('UPDATE "user" SET "twoFactorEnabled"=false,"updatedAt"=now() WHERE id=$1', [id]);
    return { ...result, owner_active: owner.rows[0].active, password_signin_required: true };
  });
}

async function main() {
  // Keep the previous local command as an alias for existing recovery runbooks.
  if (process.argv.length > 2 || !['RESET_OWNER_PASSWORD', 'RESET_OWNER_MFA'].includes(process.env.BRIDGE_RECOVERY_ACTION ?? '')) throw new Error('Explicit local recovery action is required.');
  const { DATABASE_URL, BRIDGE_OWNER_EMAIL, BRIDGE_OWNER_PASSWORD } = process.env;
  if (!DATABASE_URL || !BRIDGE_OWNER_EMAIL || !BRIDGE_OWNER_PASSWORD) throw new Error('Provision required recovery values through the environment.');
  delete process.env.BRIDGE_OWNER_PASSWORD;
  const database = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const result = await recoverOwner(database, { email: BRIDGE_OWNER_EMAIL, password: BRIDGE_OWNER_PASSWORD });
    process.stdout.write(`${JSON.stringify({ action: 'owner-password-recovery', ...result })}\n`);
  } finally { await database.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Owner recovery failed. Check explicit action, owner scope, password requirements, migrations, and database access. No credentials were printed.');
    process.exitCode = 1;
  });
}
