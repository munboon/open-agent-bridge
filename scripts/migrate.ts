import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pool, transaction } from '../src/lib/db';

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. No default database is used.');
const files=(await readdir(new URL('../db/',import.meta.url))).filter(name=>name.endsWith('.sql'));
files.sort((a,b)=>a==='owner-auth.sql'?-1:b==='owner-auth.sql'?1:a.localeCompare(b));
try {
  await transaction(pool,async client=> {
    await client.query('SELECT pg_advisory_xact_lock(71349025)');
    await client.query('CREATE TABLE IF NOT EXISTS bridge_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of files) {
      const sql=await readFile(new URL(`../db/${name}`,import.meta.url),'utf8');
      const digest=createHash('sha256').update(sql).digest('hex');
      const previous=await client.query('SELECT digest FROM bridge_migrations WHERE name=$1',[name]);
      if(previous.rowCount) {
        if(previous.rows[0].digest!==digest) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO bridge_migrations(name,digest) VALUES($1,$2)',[name,digest]);
      process.stdout.write(`Applied ${name}\n`);
    }
  });
} finally {await pool.end();}
