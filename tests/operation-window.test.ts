import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { adminOperation } from '../src/lib/admin-service';
import { handleAgentRequest } from '../src/lib/agent-api';
import { agentTransaction } from '../src/lib/agent-auth';
import { createConversation } from '../src/lib/messaging';

describe.skipIf(!process.env.TEST_DATABASE_URL)('T05 bounded operation windows through the agent HTTP handler',()=>{
  let database:Pool,project:string,environment:string,developer:string,deployment:string,conversation:string;
  const owner={id:randomUUID(),email:`window-${randomUUID()}@example.test`};
  const access={developer:{token:'',session:randomUUID()},deployment:{token:'',session:randomUUID()}};
  const admin=async(path:string[],body:unknown)=> {
    // Bare fixtures: environment provisioning is covered separately.
    if(path.length===3&&path[2]==='environments')return (await database.query('INSERT INTO bridge_environments(id,project_id,name) VALUES($1,$2,$3) RETURNING *',[randomUUID(),path[1],(body as {name:string}).name])).rows[0];
    return adminOperation(database,owner,'POST',path,body);
  };
  async function call(role:keyof typeof access,path:string,body?:unknown,key=randomUUID()){
    const response=await handleAgentRequest(new Request(`http://127.0.0.1/api/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${access[role].token}`,'X-Bridge-Session':access[role].session,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)}),database);
    return {status:response.status,body:await response.json()};
  }
  async function claimed(){
    const created=await call('developer','tasks',{conversation_id:conversation,recipient_agent_id:deployment,title:'Synthetic window',instructions:'No local commands run.'});
    expect(created.status).toBe(200);
    const claim=await call('deployment',`tasks/${created.body.task.id}/claim`,{});expect(claim.status).toBe(200);return claim.body.task;
  }
  beforeAll(async()=>{
    const url=new URL(process.env.TEST_DATABASE_URL!);
    if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test'||url.username!=='oab_test')throw new Error('Only the isolated project test database is permitted.');
    database=new Pool({connectionString:url.toString(),max:2,connectionTimeoutMillis:5000});
    await database.query('INSERT INTO "user"(id,name,email,"createdAt","updatedAt") VALUES($1,\'Synthetic window owner\',$2,now(),now())',[owner.id,owner.email]);
    await database.query('INSERT INTO bridge_owner_state(owner_id) VALUES($1)',[owner.id]);
    project=(await admin(['projects'],{name:'Operation window regression',client_label:'Synthetic only'}) as {id:string}).id;
    environment=(await admin(['projects',project,'environments'],{name:'Disposable'}) as {id:string}).id;
    developer=(await admin(['projects',project,'agents'],{name:'Developer',role:'development',environment_id:(await admin(['projects',project,'environments'],{name:'Agent host '+randomUUID()}) as {id:string}).id}) as {id:string}).id;
    deployment=(await admin(['projects',project,'agents'],{name:'Deployment',role:'deployment',environment_id:(await admin(['projects',project,'environments'],{name:'Agent host '+randomUUID()}) as {id:string}).id}) as {id:string}).id;
    await admin(['projects',project,'pairings'],{agent_a:developer,agent_b:deployment});
    for(const[role,id]of [['developer',developer],['deployment',deployment]] as const){access[role].token=(await admin(['projects',project,'agents',id,'credentials'],{}) as {token:string}).token;await database.query('UPDATE bridge_agents SET session_id=$2,generation=3 WHERE id=$1',[id,access[role].session]);}
    conversation=(await agentTransaction(database,access.developer,(client,who)=>createConversation(client,who,deployment))).id;
  });
  afterAll(async()=>{
    if(!database)return;
    for(const table of ['bridge_messages','bridge_tasks','bridge_conversations','bridge_pairings'])await database.query(`DELETE FROM ${table} WHERE project_id=$1`,[project]);
    const agents=[developer,deployment].filter(Boolean);
    await database.query('DELETE FROM bridge_credentials WHERE agent_id=ANY($1::uuid[])',[agents]);
    await database.query('DELETE FROM bridge_idempotency WHERE actor_id=ANY($1::text[])',[agents]);
    await database.query('DELETE FROM bridge_rate_windows WHERE actor_id=ANY($1::text[])',[agents]);
    await database.query('DELETE FROM bridge_agents WHERE project_id=$1',[project]);
    await database.query('DELETE FROM bridge_environments WHERE project_id=$1',[project]);
    await database.query('DELETE FROM bridge_audit WHERE owner_id=$1',[owner.id]);
    await database.query('DELETE FROM bridge_projects WHERE owner_id=$1',[owner.id]);
    await database.query('DELETE FROM "user" WHERE id=$1',[owner.id]);await database.end();
  });
  it('grants a declared stage beyond the normal five-minute lease with an exact idempotent replay',async()=>{
    const task=await claimed(),key=randomUUID(),body={claim_generation:task.claim_generation,stage:'Synthetic bounded long stage',duration_seconds:900};
    const before=Date.now(),granted=await call('deployment',`tasks/${task.id}/operation-window`,body,key);
    expect(granted.status).toBe(200);
    expect(new Date(granted.body.task.lease_until).getTime()).toBeGreaterThan(new Date(task.lease_until).getTime()+590000);
    expect(new Date(granted.body.task.lease_until).getTime()).toBeGreaterThanOrEqual(before+900000);
    expect(new Date(granted.body.task.lease_until).getTime()).toBeLessThanOrEqual(Date.now()+900000);
    expect(granted.body.task.claim_generation).toBe(task.claim_generation);
    expect(granted.body.notification.body).toContain(body.stage);
    const replay=await call('deployment',`tasks/${task.id}/operation-window`,body,key);
    expect(replay).toEqual(granted);
    expect((await database.query('SELECT count(*) FROM bridge_messages WHERE id=$1',[granted.body.notification.id])).rows[0].count).toBe('1');
  });
  it('enforces the 60-minute maximum and rejects malformed or unnamed windows without changing the lease',async()=>{
    const task=await claimed();
    for(const duration of [0,-1,3601,1.5])expect((await call('deployment',`tasks/${task.id}/operation-window`,{claim_generation:task.claim_generation,stage:'Bounded',duration_seconds:duration})).status).toBe(422);
    expect((await call('deployment',`tasks/${task.id}/operation-window`,{claim_generation:task.claim_generation,duration_seconds:600})).body.code).toBe('STAGE_REQUIRED');
    expect((await database.query('SELECT lease_until FROM bridge_tasks WHERE id=$1',[task.id])).rows[0].lease_until.toISOString()).toBe(task.lease_until);
    const maximum=await call('deployment',`tasks/${task.id}/operation-window`,{claim_generation:task.claim_generation,stage:'Maximum stage',duration_seconds:3600});expect(maximum.status).toBe(200);
    expect(new Date(maximum.body.task.lease_until).getTime()-Date.now()).toBeGreaterThan(3590000);
  });
  it('rejects an expired window, stale replay, and further result writes until explicit reconciliation',async()=>{
    const task=await claimed(),key=randomUUID(),body={claim_generation:task.claim_generation,stage:'Overrun fixture',duration_seconds:600};
    expect((await call('deployment',`tasks/${task.id}/operation-window`,body,key)).status).toBe(200);
    // Move only this synthetic claim past its deadline; no multi-minute sleep or global fake clock.
    await database.query("UPDATE bridge_tasks SET lease_until=now()-interval '1 second' WHERE id=$1",[task.id]);
    expect((await call('deployment',`tasks/${task.id}/operation-window`,body,key)).body.code).toBe('CLAIM_STALE');
    expect((await call('deployment',`tasks/${task.id}/operation-window`,body)).body.code).toBe('CLAIM_STALE');
    expect((await call('deployment',`tasks/${task.id}/events`,{claim_generation:task.claim_generation,type:'completed',evidence:'Unreconciled result'})).body.code).toBe('CLAIM_STALE');
    const tasks=await call('deployment','tasks');expect(tasks.body.tasks.find((value:{id:string})=>value.id===task.id).state).toBe('needs_reconciliation');
    expect((await call('deployment',`tasks/${task.id}/claim`,{})).body.code).toBe('TASK_STATE');
    const reconciled=await call('deployment',`tasks/${task.id}/reconcile`,{outcome:'continue',local_operation_stopped:true,evidence:'Synthetic ledger confirms no operation is running.'});
    expect(reconciled.status).toBe(200);expect(reconciled.body.task.claim_generation).toBe(task.claim_generation+1);
    expect((await call('deployment',`tasks/${task.id}/operation-window`,body)).body.code).toBe('CLAIM_STALE');
  });
  it('does not grant an operation window to the requester or a stale claim generation',async()=>{
    const task=await claimed(),body={claim_generation:task.claim_generation,stage:'Wrong actor',duration_seconds:600};
    expect((await call('developer',`tasks/${task.id}/operation-window`,body)).status).toBe(404);
    expect((await call('deployment',`tasks/${task.id}/operation-window`,{...body,claim_generation:task.claim_generation+1})).body.code).toBe('CLAIM_STALE');
  });
  it('blocks a new window and cached window replay after cancellation',async()=>{
    const task=await claimed(),key=randomUUID(),body={claim_generation:task.claim_generation,stage:'Cancelled stage',duration_seconds:600};
    expect((await call('deployment',`tasks/${task.id}/operation-window`,body,key)).status).toBe(200);
    expect((await call('developer',`tasks/${task.id}/cancel`,{})).status).toBe(200);
    expect((await call('deployment',`tasks/${task.id}/operation-window`,body)).body.code).toBe('CANCEL_REQUESTED');
    expect((await call('deployment',`tasks/${task.id}/operation-window`,body,key)).body.code).toBe('CLAIM_STALE');
  });
});
