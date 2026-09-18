import {randomBytes} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {GET} from '../src/app/api/ready/route';
import {pool} from '../src/lib/db';

describe.skipIf(!process.env.TEST_DATABASE_URL)('release readiness',()=> {
  const names=['NODE_ENV','BETTER_AUTH_URL','BETTER_AUTH_SECRET','BRIDGE_ENVELOPE_KEY'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  beforeAll(()=> {
    const target=new URL(process.env.DATABASE_URL!);
    if(target.hostname!=='127.0.0.1'||target.port!=='55442'||target.pathname!=='/oab_test')throw Error('Isolated test database required');
    Object.assign(process.env,{NODE_ENV:'production',BETTER_AUTH_URL:'https://bridge.example.test',BETTER_AUTH_SECRET:randomBytes(48).toString('base64'),BRIDGE_ENVELOPE_KEY:randomBytes(32).toString('base64')});
  });
  afterAll(async()=> {for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}await pool.end();});
  it('requires configured production HTTPS and the migrated database',async()=> {
    const response=await GET();expect(response.status).toBe(200);expect(await response.json()).toEqual({ready:true});
  });
  it('fails closed for production loopback HTTP without leaking configuration',async()=> {
    process.env.BETTER_AUTH_URL='http://127.0.0.1:3220';
    const response=await GET();expect(response.status).toBe(503);expect(await response.json()).toEqual({ready:false});
    process.env.BETTER_AUTH_URL='https://bridge.example.test';
  });
  it.each(['021-device-binding.sql','022-agent-contact.sql'])('does not report ready without %s',async(name)=> {
    const saved=(await pool.query('DELETE FROM bridge_migrations WHERE name=$1 RETURNING *',[name])).rows[0];
    expect(saved).toBeTruthy();
    try {
      const response=await GET();expect(response.status).toBe(503);expect(await response.json()).toEqual({ready:false});
    } finally {
      await pool.query('INSERT INTO bridge_migrations(name,digest,applied_at) VALUES($1,$2,$3)',[saved.name,saved.digest,saved.applied_at]);
    }
    expect((await GET()).status).toBe(200);
  });
  it('fails closed when transfer envelope encryption is unavailable',async()=> {
    delete process.env.BRIDGE_ENVELOPE_KEY;
    const response=await GET();expect(response.status).toBe(503);expect(await response.json()).toEqual({ready:false});
  });
});
