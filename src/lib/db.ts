import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const globalDatabase = globalThis as unknown as { bridgePool?: Pool };
export const pool = globalDatabase.bridgePool ?? new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://unconfigured@127.0.0.1:1/unconfigured',
  max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
  application_name: 'open-agent-bridge',
});
if (process.env.NODE_ENV !== 'production') globalDatabase.bridgePool = pool;
export const db = drizzle(pool);
export type Transaction = PoolClient;

export async function transaction<T>(database: Pool, work: (client: Transaction) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '8s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
