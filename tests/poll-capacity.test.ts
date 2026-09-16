import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { newCredential } from '../src/lib/agent-auth';
import { handleAgentRequest } from '../src/lib/agent-api';

describe.skipIf(!process.env.TEST_DATABASE_URL)('O03 process-local polling and rate capacity',()=>{
  let database:Pool;
  const owner=randomUUID(),project=randomUUID(),environment=randomUUID();
  const agents=Array.from({length:102},()=>({id:randomUUID(),session:randomUUID(),credential:newCredential()}));
  const application=`oab-capacity-${randomUUID()}`;
  const controllers:AbortController[]=[];
  const pending:Promise<Response>[]=[];
  function request(index:number,path='inbox?wait_seconds=20',signal?:AbortSignal){
    return handleAgentRequest(new Request(`http://127.0.0.1/api/v1/${path}`,{headers:{Authorization:`Bearer ${agents[index].credential.token}`,'X-Bridge-Session':agents[index].session},signal}),database);
  }
  async function until(check:()=>Promise<boolean>,milliseconds=5000){
    const deadline=performance.now()+milliseconds;
    while(performance.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20));}
    throw new Error('Bounded capacity condition did not become ready.');
  }
  beforeAll(async()=>{
    const url=new URL(process.env.TEST_DATABASE_URL!);
    if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test'||url.username!=='oab_test')throw new Error('Only the isolated project test database is permitted.');
    database=new Pool({connectionString:url.toString(),max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,application_name:application});
    await database.query('INSERT INTO "user"(id,name,email,"createdAt","updatedAt") VALUES($1,\'Synthetic capacity owner\',$2,now(),now())',[owner,`${owner}@example.test`]);
    await database.query('INSERT INTO bridge_owner_state(owner_id) VALUES($1)',[owner]);
    await database.query("INSERT INTO bridge_projects(id,owner_id,name,client_label) VALUES($1,$2,'Capacity regression','Synthetic only')",[project,owner]);
    await database.query("INSERT INTO bridge_environments(id,project_id,name) VALUES($1,$2,'Isolated')",[environment,project]);
    await database.query(`INSERT INTO bridge_agents(id,project_id,environment_id,name,role,session_id,generation)
      SELECT v.id,$1,$2,'Synthetic poller','deployment',v.session,1 FROM jsonb_to_recordset($3::jsonb) AS v(id uuid,session uuid)`,[project,environment,JSON.stringify(agents.map(({id,session})=>({id,session})))]);
    await database.query(`INSERT INTO bridge_credentials(id,agent_id,digest,expires_at)
      SELECT v.id,v.agent_id,v.digest,now()+interval '1 day' FROM jsonb_to_recordset($1::jsonb) AS v(id uuid,agent_id uuid,digest text)`,[JSON.stringify(agents.map(({id,credential})=>({id:credential.id,agent_id:id,digest:credential.digest})))]);
  },10000);
  afterAll(async()=>{
    controllers.forEach(controller=>controller.abort());await Promise.allSettled(pending);
    vi.restoreAllMocks();if(!database)return;
    const ids=agents.map(agent=>agent.id);
    await database.query('DELETE FROM bridge_rate_windows WHERE actor_id=ANY($1::text[])',[ids]);
    await database.query('DELETE FROM bridge_credentials WHERE agent_id=ANY($1::uuid[])',[ids]);
    await database.query('DELETE FROM bridge_agents WHERE project_id=$1',[project]);
    await database.query('DELETE FROM bridge_environments WHERE project_id=$1',[project]);
    await database.query('DELETE FROM bridge_projects WHERE id=$1',[project]);
    await database.query('DELETE FROM "user" WHERE id=$1',[owner]);await database.end();
  },10000);
  it('admits 100 distinct polls, rejects duplicate/101st polls with retry guidance, and frees resources on abort',async()=>{
    let maximumConnections=0,settled=0;
    const sample=setInterval(()=>{maximumConnections=Math.max(maximumConnections,database.totalCount);},2);
    try{
      for(let index=0;index<100;index++){
        const controller=new AbortController();controllers.push(controller);
        const poll=request(index,undefined,controller.signal);pending.push(poll);void poll.then(()=>{settled++;});
      }
      // Every agent must have passed the real authentication transaction before admission checks.
      await until(async()=>Number((await database.query('SELECT count(*) FROM bridge_agents WHERE project_id=$1 AND last_seen_at IS NOT NULL',[project])).rows[0].count)===100);
      await new Promise(resolve=>setTimeout(resolve,50));
      expect(settled).toBe(0);
      const duplicate=await request(0);expect(duplicate.status).toBe(429);expect(duplicate.headers.get('Retry-After')).toBe('5');
      expect((await duplicate.json()).code).toBe('POLL_ALREADY_ACTIVE');
      const overflow=await request(100);expect(overflow.status).toBe(503);expect(overflow.headers.get('Retry-After')).toBe('5');
      expect((await overflow.json()).code).toBe('POLL_CAPACITY');
      const backends=Number((await database.query('SELECT count(*) FROM pg_stat_activity WHERE application_name=$1',[application])).rows[0].count);
      expect(backends).toBeGreaterThan(0);expect(backends).toBeLessThanOrEqual(8);
      expect(maximumConnections).toBe(8);expect(database.totalCount).toBeLessThanOrEqual(8);
      const abortedAt=performance.now();controllers.forEach(controller=>controller.abort());
      const responses=await Promise.all(pending);
      expect(responses.every(response=>response.status===499)).toBe(true);
      expect(performance.now()-abortedAt).toBeLessThan(5000);
      await until(async()=>database.waitingCount===0&&database.idleCount===database.totalCount);
      expect((await request(0,'inbox?wait_seconds=0')).status).toBe(200);
      expect((await request(100,'inbox?wait_seconds=0')).status).toBe(200);
    }finally{clearInterval(sample);controllers.forEach(controller=>controller.abort());await Promise.allSettled(pending);}
  },15000);
  it('admits 240 valid-agent requests in one fixed minute and rejects the next without using the anonymous budget',async()=>{
    // Freeze only Date.now in this test worker, avoiding a minute-boundary race while PostgreSQL remains live.
    const fixedNow=Date.now(),window=Math.floor(fixedNow/60000);
    const clock=vi.spyOn(Date,'now').mockReturnValue(fixedNow);
    try{
      for(let count=1;count<=240;count++)expect((await request(101,'bootstrap')).status).toBe(200);
      const limited=await request(101,'bootstrap');expect(limited.status).toBe(429);expect(limited.headers.get('Retry-After')).toBe('5');
      expect((await limited.json()).code).toBe('RATE_LIMITED');
      expect((await database.query('SELECT count FROM bridge_rate_windows WHERE actor_id=$1 AND window_start=$2',[agents[101].id,window])).rows[0].count).toBe(241);
      expect((await request(100,'bootstrap')).status).toBe(200);
    }finally{clock.mockRestore();}
  },10000);
});
