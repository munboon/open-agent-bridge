import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import { Pool } from 'pg';

export interface BootstrapOwnerInput { email: string; password: string; name: string }

export async function bootstrapOwner(pool: Pool, input: BootstrapOwnerInput): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !name || name.length > 200 || input.password.length < 16 || input.password.length > 128) {
    throw new Error('Supply a valid owner email, name, and a password of 16 to 128 characters.');
  }
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('oab-single-owner-bootstrap'))");
    const existing = await client.query('SELECT 1 FROM bridge_owner_state UNION ALL SELECT 1 FROM "user" LIMIT 1');
    if (existing.rowCount) throw new Error('Owner bootstrap is already complete or auth data exists; no account was changed.');
    const id = randomUUID();
    await client.query(
      'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt","twoFactorEnabled") VALUES ($1,$2,$3,true,now(),now(),false)',
      [id, name, email],
    );
    await client.query(
      'INSERT INTO account (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$2,\'credential\',$2,$3,now(),now())',
      [randomUUID(), id, passwordHash],
    );
    await client.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES ($1,true)', [id]);
    if((await client.query("SELECT to_regclass('bridge_administrators') AS table_name")).rows[0].table_name)await client.query("INSERT INTO bridge_administrators(user_id,workspace_owner_id,username,role) VALUES($1,$1,'admin','platform')",[id]);
    await client.query('COMMIT');
    return { id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function main() {
  if (process.argv.length > 2) throw new Error('Bootstrap takes no command-line arguments. Provision values through the environment.');
  const { DATABASE_URL, BRIDGE_OWNER_EMAIL, BRIDGE_OWNER_PASSWORD, BRIDGE_OWNER_NAME } = process.env;
  if (!DATABASE_URL || !BRIDGE_OWNER_EMAIL || !BRIDGE_OWNER_PASSWORD || !BRIDGE_OWNER_NAME) {
    throw new Error('DATABASE_URL, BRIDGE_OWNER_EMAIL, BRIDGE_OWNER_PASSWORD, and BRIDGE_OWNER_NAME are required.');
  }
  delete process.env.BRIDGE_OWNER_PASSWORD;
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await bootstrapOwner(pool, { email: BRIDGE_OWNER_EMAIL, password: BRIDGE_OWNER_PASSWORD, name: BRIDGE_OWNER_NAME });
    console.log('Owner created. Sign in with the provisioned email and password.');
  } finally { await pool.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // No raw database errors: connection strings or query parameters may be sensitive.
    console.error('Owner bootstrap failed. Check required environment, applied migration, and whether an owner already exists. No credentials were printed.');
    process.exitCode = 1;
  });
}
