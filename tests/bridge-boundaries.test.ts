import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoleKit } from '../src/lib/role-kits';
import { handleAgentRequest } from '../src/lib/agent-api';
import { issueAgentKit } from '../src/lib/agent-kit';
import { ownerTransaction } from '../src/lib/admin-service';
import { adminOperation } from '../src/lib/admin-service';
import { newCredential } from '../src/lib/agent-auth';

const enabled=Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)('real PostgreSQL bridge boundaries and recovery',()=> {
  let database:Pool;
  const owner={id:randomUUID(),email:`bridge-${randomUUID()}@example.test`};
  const outsider={id:randomUUID(),email:`bridge-${randomUUID()}@example.test`};
  let project:string,environment:string,dev:string,deploy:string,foreign:string;
  let devToken:string,deployToken:string,foreignToken:string,devSession:string,deploySession:string,foreignSession:string;
  let conversation:string;
  const oldEnvelope=process.env.BRIDGE_ENVELOPE_KEY;
  async function api(token:string,session:string|undefined,path:string,body?:unknown,key=randomUUID()) {
    const request=new Request(`http://127.0.0.1/api/v1/${path}`,{method:body===undefined?'GET':'POST',
      headers:{authorization:`Bearer ${token}`,...(session?{'X-Bridge-Session':session}:{}),'Content-Type':'application/json','Idempotency-Key':key},
      body:body===undefined?undefined:JSON.stringify(body)});
    const response=await handleAgentRequest(request,database);
    return {status:response.status,data:await response.json()};
  }
  async function admin(path:string[],body:unknown,identity=owner) {
    // Bare legacy fixtures isolate protocol tests from automatic environment provisioning.
    if(path.length===3&&path[2]==='environments')return (await database.query('INSERT INTO bridge_environments(id,project_id,name) VALUES($1,$2,$3) RETURNING *',[randomUUID(),path[1],(body as {name:string}).name])).rows[0];
    return adminOperation(database,identity,'POST',path,body);
  }
  beforeAll(async()=> {
    const url=new URL(process.env.TEST_DATABASE_URL!);
    if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test'||url.username!=='oab_test') throw new Error('Only the isolated test database is permitted.');
    database=new Pool({connectionString:url.toString(),max:8});
    process.env.BRIDGE_ENVELOPE_KEY=randomBytes(32).toString('base64');
    for(const who of [owner,outsider]) {
      await database.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[who.id,'Synthetic owner',who.email]);
      await database.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)',[who.id]);
    }
    project=(await admin(['projects'],{name:'Synthetic bridge',client_label:'Test only'}) as {id:string}).id;
    environment=(await admin(['projects',project,'environments'],{name:'Disposable'}) as {id:string}).id;
    dev=(await admin(['projects',project,'agents'],{name:'Developer',role:'development',environment_id:environment}) as {id:string}).id;
    deploy=(await admin(['projects',project,'agents'],{name:'Deployment',role:'deployment',environment_id:(await admin(['projects',project,'environments'],{name:'Agent host '+randomUUID()}) as {id:string}).id}) as {id:string}).id;
    await admin(['projects',project,'pairings'],{agent_a:dev,agent_b:deploy});
    devToken=(await admin(['projects',project,'agents',dev,'credentials'],{}) as {token:string}).token;
    deployToken=(await admin(['projects',project,'agents',deploy,'credentials'],{}) as {token:string}).token;
    const foreignProject=(await admin(['projects'],{name:'Other owner',client_label:'Test only'},outsider) as {id:string}).id;
    const foreignEnv=(await admin(['projects',foreignProject,'environments'],{name:'Other'},outsider) as {id:string}).id;
    foreign=(await admin(['projects',foreignProject,'agents'],{name:'Foreign',role:'deployment',environment_id:foreignEnv},outsider) as {id:string}).id;
    foreignToken=(await admin(['projects',foreignProject,'agents',foreign,'credentials'],{},outsider) as {token:string}).token;
    devSession=(await api(devToken,undefined,'sessions',{})).data.session_id;
    deploySession=(await api(deployToken,undefined,'sessions',{})).data.session_id;
    foreignSession=(await api(foreignToken,undefined,'sessions',{})).data.session_id;
    const convo=await api(devToken,devSession,'conversations',{recipient_agent_id:deploy});
    expect(convo.status).toBe(200); conversation=convo.data.id;
  });
  it('fences resource samples to the current identity and revokes all access from the owner menu',async()=> {
    const metrics={cpu_percent:35,cpu_count:4,memory_total_bytes:8192,memory_available_bytes:2048,platform:'linux'};
    expect((await api(devToken,devSession,'telemetry',metrics)).status).toBe(200);
    expect((await api(devToken,randomUUID(),'telemetry',metrics)).status).toBe(409);
    expect((await api(devToken,devSession,'telemetry',{...metrics,memory_available_bytes:9000})).status).toBe(422);
    const stored=(await database.query('SELECT host_metrics,host_metrics_at FROM bridge_agents WHERE id=$1',[dev])).rows[0];
    expect(stored.host_metrics.cpu_percent).toBe(35);
    expect(stored.host_metrics_at).toBeInstanceOf(Date);
    expect((await database.query('SELECT host_metrics FROM bridge_agents WHERE id=$1',[foreign])).rows[0].host_metrics).toBeNull();
    await expect(admin(['projects',project,'agents',foreign,'revoke-access'],{confirm:true})).rejects.toThrow();
    const env=await admin(['projects',project,'environments'],{name:'External agent'});
    const external=await admin(['projects',project,'agents'],{environment_id:env.id,name:'External reviewer',role:'development'}) as {id:string};
    const kit=await ownerTransaction(database,owner,client=>issueAgentKit(client,owner,project,external.id,{format:'third-party'}));
    expect(kit.filename).toMatch(/\.md$/);
    expect(kit.contentType).toContain('text/markdown');
    const prompt=kit.archive.toString('utf8');
    const config=JSON.parse(prompt.split('```json\n')[1].split('```')[0]);
    expect(config.name).toBe('External reviewer');
    expect((await api(config.access_token,undefined,'bootstrap')).status).toBe(200);
    const registered=await api(config.access_token,undefined,'sessions',{});
    expect(registered.status).toBe(200);
    expect((await api(config.access_token,registered.data.session_id,'peers')).status).toBe(200);
    await admin(['projects',project,'agents',external.id,'revoke-access'],{confirm:true});
    expect((await api(config.access_token,registered.data.session_id,'peers')).status).toBe(401);

  });
  it('delivers direct owner messages before pairing, supports replies and isolates the channel',async()=> {
    const solo=(await admin(['projects',project,'agents'],{name:'Unpaired monitored agent',role:'deployment',environment_id:(await admin(['projects',project,'environments'],{name:'Agent host '+randomUUID()}) as {id:string}).id}) as {id:string}).id;
    const token=(await admin(['projects',project,'agents',solo,'credentials'],{}) as {token:string}).token;
    const payload={recipient_agent_id:solo,body:'Synthetic owner request'}; const key=randomUUID();
    const sent=await adminOperation(database,owner,'POST',['projects',project,'messages'],payload,{key}) as any;
    const replay=await adminOperation(database,owner,'POST',['projects',project,'messages'],payload,{key}) as any;
    expect(replay.id).toBe(sent.id);
    await expect(adminOperation(database,outsider,'POST',['projects',project,'messages'],payload,{key:randomUUID()})).rejects.toThrow();
    const session=(await api(token,undefined,'sessions',{})).data.session_id;
    const received=await api(token,session,'inbox');expect(received.data.messages.map((m:any)=>m.id)).toContain(sent.id);
    expect((await api(devToken,devSession,`conversations/${sent.conversation_id}/messages`)).status).toBe(404);
    const reply=await api(token,session,'messages',{conversation_id:sent.conversation_id,recipient_agent_id:solo,type:'note',body:'Synthetic reply'});
    expect(reply.status).toBe(200);expect(reply.data.acknowledged_at).toBeTruthy();
    expect((await api(token,session,'acknowledgements',{message_ids:[sent.id]})).status).toBe(200);
    expect((await api(token,session,'inbox')).data.messages).toHaveLength(0);
    const history=await adminOperation(database,owner,'GET',['projects',project,'conversations',sent.conversation_id,'messages'],null) as any;
    expect(history.messages.map((m:any)=>m.body)).toEqual(['Synthetic owner request','Synthetic reply']);
    const latest=await adminOperation(database,owner,'GET',['projects',project,'conversations',sent.conversation_id,'messages'],null,{query:new URLSearchParams({before_sequence:String(Number.MAX_SAFE_INTEGER)})}) as any;
    expect(latest.messages.map((m:any)=>m.body)).toEqual(['Synthetic owner request','Synthetic reply']);
    const earlier=await adminOperation(database,owner,'GET',['projects',project,'conversations',sent.conversation_id,'messages'],null,{query:new URLSearchParams({before_sequence:String(reply.data.sequence)})}) as any;
    expect(earlier.messages.map((m:any)=>m.id)).toEqual([sent.id]);
    expect(earlier.next_sequence).toBe(Number(sent.sequence));
    const snap=await adminOperation(database,owner,'GET',['projects',project],null) as any;
    expect(snap.agents.find((a:any)=>a.id===solo).status).toMatchObject({connection:'connected',work:'unknown',provisioned:true});
    await database.query("UPDATE bridge_agents SET last_seen_at=now()-interval '76 seconds' WHERE id=$1",[solo]);
    const stale=await adminOperation(database,owner,'GET',['projects',project],null) as any;
    expect(stale.agents.find((a:any)=>a.id===solo).status).toMatchObject({connection:'disconnected',work:'unknown'});
  });
  afterAll(async()=> {
    if(!database)return;
    const ids=[owner.id,outsider.id];
    // Delete only these synthetic owners' rows, preserving other suites' data.
    const projects=(await database.query('SELECT id FROM bridge_projects WHERE owner_id=ANY($1::text[])',[ids])).rows.map(row=>row.id);
    const agents=(await database.query('SELECT id FROM bridge_agents WHERE project_id=ANY($1::uuid[])',[projects])).rows.map(row=>row.id);
    await database.query('DELETE FROM bridge_recipient_keys WHERE agent_id=ANY($1::uuid[])',[agents]);
    await database.query('DELETE FROM bridge_receipts WHERE transfer_id IN (SELECT id FROM bridge_transfers WHERE project_id=ANY($1::uuid[]))',[projects]);
    await database.query('DELETE FROM bridge_offers WHERE transfer_id IN (SELECT id FROM bridge_transfers WHERE project_id=ANY($1::uuid[]))',[projects]);
    await database.query('DELETE FROM bridge_transfers WHERE project_id=ANY($1::uuid[])',[projects]);
    for(const table of ['bridge_messages','bridge_tasks','bridge_conversations','bridge_pairings']) await database.query(`DELETE FROM ${table} WHERE project_id=ANY($1::uuid[])`,[projects]);
    await database.query('DELETE FROM bridge_credentials WHERE agent_id=ANY($1::uuid[])',[agents]);
    await database.query('DELETE FROM bridge_idempotency WHERE actor_id=ANY($1::text[])',[agents]);
    await database.query('DELETE FROM bridge_rate_windows WHERE actor_id=ANY($1::text[])',[agents]);
    await database.query('DELETE FROM bridge_agents WHERE project_id=ANY($1::uuid[])',[projects]);
    await database.query('DELETE FROM bridge_environments WHERE project_id=ANY($1::uuid[])',[projects]);
    await database.query('DELETE FROM bridge_audit WHERE owner_id=ANY($1::text[])',[ids]);
    await database.query('DELETE FROM bridge_projects WHERE owner_id=ANY($1::text[])',[ids]);
    await database.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[ids]);
    await database.end();
    if(oldEnvelope===undefined)delete process.env.BRIDGE_ENVELOPE_KEY;else process.env.BRIDGE_ENVELOPE_KEY=oldEnvelope;
  });
  it('automatically pairs the two project roles across server labels and preserves work on restart',async()=> {
    const p=(await admin(['projects'],{name:'Automatic restart test',client_label:'Synthetic'}) as {id:string}).id;
    const identities:string[]=[],tokens:string[]=[];
    for(const role of ['development','deployment']) {
      const env=(await admin(['projects',p,'environments'],{name:role+' host'}) as {id:string}).id;
      const id=(await admin(['projects',p,'agents'],{name:role,role,environment_id:env}) as {id:string}).id;
      identities.push(id);tokens.push((await admin(['projects',p,'agents',id,'credentials'],{}) as {token:string}).token);
    }
    const ds=(await api(tokens[0],undefined,'sessions',{})).data.session_id;
    expect((await api(tokens[0],ds,'peers')).data.peers).toEqual([expect.objectContaining({id:identities[1],connected:false})]);
    const old=(await api(tokens[1],undefined,'sessions',{})).data.session_id;
    expect((await api(tokens[0],ds,'peers')).data.peers.map((a:{id:string})=>a.id)).toEqual([identities[1]]);
    const c=(await api(tokens[0],ds,'conversations',{recipient_agent_id:identities[1]})).data.id;
    const message=await api(tokens[0],ds,'messages',{conversation_id:c,recipient_agent_id:identities[1],type:'note',body:'Queued before restart'});
    expect(message.status).toBe(200);
    const task=await api(tokens[0],ds,'tasks',{conversation_id:c,recipient_agent_id:identities[1],title:'Restart recovery',instructions:'Synthetic only'});
    expect(task.status).toBe(200);
    expect((await api(tokens[1],old,`tasks/${task.data.task.id}/claim`,{})).status).toBe(200);
    const current=(await api(tokens[1],undefined,'sessions',{})).data.session_id;
    expect((await api(tokens[1],old,'inbox')).status).toBe(409);
    expect((await api(tokens[1],old,'sessions/current/close',{})).status).toBe(409);
    expect((await api(tokens[1],current,'inbox')).data.messages.map((m:{id:string})=>m.id)).toContain(message.data.id);
    expect((await api(tokens[1],current,'tasks')).data.tasks.find((t:{id:string})=>t.id===task.data.task.id).state).toBe('needs_reconciliation');
    expect((await api(tokens[1],current,'messages',{conversation_id:c,recipient_agent_id:identities[0],type:'note',body:'New process, same identity'})).status).toBe(200);
    expect((await api(tokens[1],current,'conversations',{recipient_agent_id:foreign})).status).toBe(404);
    const sha=createHash('sha256').update('x').digest('hex');
    const transfer=await api(tokens[0],ds,'transfers',{conversation_id:c,direction:'download',manifest:{filename:'x.bin',size:1,sha256:sha,sensitivity:'synthetic',parts:[{index:0,offset:0,size:1,sha256:sha}]}});
    expect(transfer.status).toBe(200);
    expect((await api(tokens[1],current,`transfers/${transfer.data.transfer.id}`)).status).toBe(200);
    await admin(['projects',p,'pairings'],{agent_a:identities[0],agent_b:identities[1],enabled:false});
    expect((await api(tokens[0],ds,'peers')).data.peers).toEqual([]);
    expect((await api(tokens[0],ds,'messages',{conversation_id:c,recipient_agent_id:identities[1],type:'note',body:'Blocked message'})).status).toBe(404);
    const restarted=(await api(tokens[1],undefined,'sessions',{})).data.session_id;
    expect((await api(tokens[1],restarted,'peers')).data.peers).toEqual([]);
    expect((await api(tokens[0],ds,'peers')).data.peers).toEqual([]);
    await expect(admin(['projects',p,'pairings'],{agent_a:identities[0],agent_b:foreign,enabled:false})).rejects.toThrow();
    await admin(['projects',p,'pairings'],{agent_a:identities[1],agent_b:identities[0],enabled:true});
    expect((await api(tokens[0],ds,'peers')).data.peers.map((peer:{id:string})=>peer.id)).toEqual([identities[1]]);
    expect((await api(tokens[0],ds,'messages',{conversation_id:c,recipient_agent_id:identities[1],type:'note',body:'Communication restored'})).status).toBe(200);
    expect((await database.query('SELECT count(*) FROM bridge_pairing_blocks WHERE project_id=$1',[p])).rows[0].count).toBe('0');

  });
  it('applies bulk pairing changes atomically within the selected agent or project scope',async()=>{
    const projectId=(await admin(['projects'],{name:'Bulk links',client_label:'Synthetic'}) as {id:string}).id;
    const environment=(await admin(['projects',projectId,'environments'],{name:'Shared host'})).id;
    const ids:string[]=[];
    for(const name of ['One','Two','Three'])ids.push((await admin(['projects',projectId,'agents'],{name,role:'development',environment_id:environment}) as {id:string}).id);
    const bulk=(enabled:boolean,agent_id?:string,expected_agent_ids=ids)=>admin(['projects',projectId,'pairings','bulk'],{enabled,agent_id,expected_agent_ids}) as Promise<{pairings:{agent_a:string;agent_b:string}[];links_in_scope:number}>;
    expect((await bulk(true)).pairings).toHaveLength(3);
    expect((await bulk(true)).pairings).toHaveLength(3);
    await expect(bulk(false,undefined,ids.slice(0,2))).rejects.toMatchObject({code:'AGENTS_CHANGED'});
    expect((await database.query('SELECT count(*) FROM bridge_pairings WHERE project_id=$1',[projectId])).rows[0].count).toBe('3');
    await expect(bulk(false,foreign)).rejects.toThrow();
    const selected=await bulk(false,ids[0]);
    expect(selected.links_in_scope).toBe(2);expect(selected.pairings).toHaveLength(1);
    expect(selected.pairings.every(pair=>pair.agent_a!==ids[0]&&pair.agent_b!==ids[0])).toBe(true);
    const token=(await admin(['projects',projectId,'agents',ids[0],'credentials'],{}) as {token:string}).token;
    let session=(await api(token,undefined,'sessions',{})).data.session_id;
    expect((await api(token,session,'peers')).data.peers).toHaveLength(0);
    expect((await bulk(false)).pairings).toHaveLength(0);
    session=(await api(token,undefined,'sessions',{})).data.session_id;
    expect((await api(token,session,'peers')).data.peers).toHaveLength(0);
    expect((await bulk(true,ids[0])).pairings).toHaveLength(2);
    expect((await api(token,session,'peers')).data.peers).toHaveLength(2);
    expect((await bulk(true)).pairings).toHaveLength(3);
    expect((await database.query('SELECT count(*) FROM bridge_pairing_blocks WHERE project_id=$1',[projectId])).rows[0].count).toBe('0');
  });
  it('H05 keeps an unpaired session through 31 empty polls and a later counterpart arrival until explicit close',async()=> {
    const project=(await admin(['projects'],{name:'Late peers',client_label:'Synthetic'}) as {id:string}).id;
    const waiting=(await admin(['projects',project,'agents'],{name:'Waiting deployment',role:'deployment',environment_id:(await admin(['projects',project,'environments'],{name:'Agent host '+randomUUID()}) as {id:string}).id}) as {id:string}).id;
    const late=(await admin(['projects',project,'agents'],{name:'Late developer',role:'development',environment_id:(await admin(['projects',project,'environments'],{name:'Agent host '+randomUUID()}) as {id:string}).id}) as {id:string}).id;
    const waitingKey=(await admin(['projects',project,'agents',waiting,'credentials'],{}) as {token:string}).token;
    const lateKey=(await admin(['projects',project,'agents',late,'credentials'],{}) as {token:string}).token;
    const bootstrap=await api(waitingKey,undefined,'bootstrap');
    expect(bootstrap.data.limits).toMatchObject({idle_seconds:null,empty_polls:null,wait_seconds:20});
    expect(bootstrap.data.session_policy).toMatchObject({idle_timeout:false,rediscover_after_empty_poll:true});
    const session=(await api(waitingKey,undefined,'sessions',{})).data.session_id;
    expect((await api(waitingKey,session,'peers')).data.peers).toEqual([expect.objectContaining({id:late,connected:false})]);
    // Advance the application clock beyond the retired ten-minute cutoff; keep real database I/O and timers.
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+11*60*1000);
    try {
      for(let i=0;i<31;i++) {
        const empty=await api(waitingKey,session,'inbox?wait_seconds=0');
        expect(empty.status).toBe(200);expect(empty.data.messages).toHaveLength(0);
      }
    } finally {clock.mockRestore();}
    expect((await database.query('SELECT session_id FROM bridge_agents WHERE id=$1',[waiting])).rows[0].session_id).toBe(session);
    const pending=api(waitingKey,session,'inbox?wait_seconds=2');
    await admin(['projects',project,'pairings'],{agent_a:late,agent_b:waiting});
    const lateSession=(await api(lateKey,undefined,'sessions',{})).data.session_id;
    expect((await api(waitingKey,session,'peers')).data.peers.map((p:{id:string})=>p.id)).toContain(late);
    const channel=(await api(lateKey,lateSession,'conversations',{recipient_agent_id:waiting})).data.id;
    const sent=await api(lateKey,lateSession,'messages',{conversation_id:channel,recipient_agent_id:waiting,type:'note',body:'Counterpart arrived later'});
    expect(sent.status).toBe(200);
    const received=await pending;
    expect(received.status).toBe(200);expect(received.data.messages.map((m:{id:string})=>m.id)).toContain(sent.data.id);
    expect((await api(waitingKey,session,'acknowledgements',{message_ids:[sent.data.id]})).status).toBe(200);
    const reply=await api(waitingKey,session,'messages',{conversation_id:channel,recipient_agent_id:late,type:'note',body:'Still available in the original session'});
    expect(reply.status).toBe(200);
    expect((await api(lateKey,lateSession,'inbox')).data.messages.map((m:{id:string})=>m.id)).toContain(reply.data.id);
    const client=await database.connect();
    try {
      for(const id of [waiting,late]) {
        const kit=await createRoleKit(client,owner,project,id);
        expect(kit).toContain('Kit version 1.2.2');
        expect(kit).toContain('at most one GET');
        expect(kit).toContain('handle queued operator chat');
        expect(kit).toContain('Owner chat needs no developer or pairing');
        expect(kit).toContain('There is no idle deadline or empty-poll limit.');
        expect(kit).toContain('Repeat discovery after each empty inbox wait');
        expect(kit).not.toMatch(/Stop after 10 minutes|30 successful empty polls|wait within the idle budget/);
        // Role templates now include the owner-requested release and recovery checklist.
        expect(kit.length).toBeLessThan(8000);
        expect(kit).toContain('Successful empty polls are silent.');
        for(const topic of ['messaging','tasks','transfers'])expect(kit).toContain(`/api/v1/guides/${topic}`);
      }
    } finally {client.release();}
    for(const topic of ['messaging','tasks','transfers']) {
      expect((await api('invalid',undefined,`guides/${topic}`)).status).toBe(401);
      expect((await api(waitingKey,undefined,`guides/${topic}`)).status).toBe(409);
      const guide=await api(waitingKey,session,`guides/${topic}`);
      expect(guide.status).toBe(200);expect(guide.data).toMatchObject({version:'1.2.0',topic});
      expect(guide.data.instructions.length).toBeGreaterThan(1000);
      expect(guide.data.instructions).not.toContain(waitingKey);
    }
    expect((await api(waitingKey,session,'guides/unknown')).status).toBe(404);
    expect((await api(waitingKey,session,'sessions/current/close',{})).status).toBe(200);
    expect((await api(waitingKey,session,'peers')).status).toBe(409);
    expect((await api(lateKey,lateSession,'sessions/current/close',{})).status).toBe(200);
  });
  it('A02/A03/A04 denies anonymous, foreign conversations and forged authors',async()=> {
    expect((await api('invalid',undefined,'bootstrap')).status).toBe(401);
    expect((await api(foreignToken,foreignSession,`conversations/${conversation}/messages`)).status).toBe(404);
    expect((await api(devToken,devSession,'messages',{conversation_id:conversation,recipient_agent_id:deploy,type:'note',body:'test',sender_id:foreign})).status).toBe(422);
    await expect(adminOperation(database,outsider,'GET',['projects',project],null)).rejects.toMatchObject({status:404});
  });
  it('lists only the owner projects with safe role assignments and preserves details after archive',async()=> {
    const listing=await adminOperation(database,owner,'GET',[],null) as any;
    const listed=listing.projects.find((p:any)=>p.id===project);
    expect(listed.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({id:dev,name:'Developer',role:'development',environment_id:environment,environment_name:'Disposable',active:true}),
      expect.objectContaining({id:deploy,name:'Deployment',role:'deployment'}),
    ]));
    for(const item of listing.projects) {
      expect(item.owner_id).toBe(owner.id);
      for(const agent of item.agents)expect(Object.keys(agent).sort()).toEqual(['active','environment_id','environment_name','id','name','role','status']);
    }
    const empty=(await admin(['projects'],{name:'Directory archive fixture',client_label:'Test only'}) as {id:string}).id;
    let projects=(await adminOperation(database,owner,'GET',[],null) as any).projects;
    expect(projects.find((p:any)=>p.id===empty).agents).toEqual([]);
    await expect(admin(['projects',empty,'state'],{state:'archived'},outsider)).rejects.toMatchObject({status:404});
    await admin(['projects',empty,'state'],{state:'archived'});
    projects=(await adminOperation(database,owner,'GET',[],null) as any).projects;
    expect(projects.find((p:any)=>p.id===empty)).toMatchObject({state:'archived',agents:[]});
    expect((await adminOperation(database,owner,'GET',['projects',empty],null) as any).project.state).toBe('archived');
    await admin(['projects',empty,'state'],{state:'active'});
    expect((await adminOperation(database,owner,'GET',['projects',empty],null) as any).project.state).toBe('active');
  });
  it('M01/M02 stores one message under retries and rejects different content',async()=> {
    const body={conversation_id:conversation,recipient_agent_id:deploy,type:'note',body:'Durable original'};
    const key=randomUUID();
    const original=await api(devToken,devSession,'messages',body,key);
    const retry=await api(devToken,devSession,'messages',body,key);
    expect(retry).toEqual(original);
    expect((await api(devToken,devSession,'messages',{...body,body:'Changed'},key)).status).toBe(409);
    const count=await database.query('SELECT count(*) FROM bridge_messages WHERE id=$1',[original.data.id]);
    expect(Number(count.rows[0].count)).toBe(1);
  });
  it('permanently deletes only the confirmed owner project and fences its agents',async()=> {
    const doomed=(await admin(['projects'],{name:'Delete fixture',client_label:'Synthetic only'}) as {id:string}).id;
    const env=(await admin(['projects',doomed,'environments'],{name:'Disposable'}) as {id:string}).id;
    const a=(await admin(['projects',doomed,'agents'],{name:'Dev',role:'development',environment_id:env}) as {id:string}).id;
    const b=(await admin(['projects',doomed,'agents'],{name:'Deploy',role:'deployment',environment_id:(await admin(['projects',doomed,'environments'],{name:'Deployment host'}) as {id:string}).id}) as {id:string}).id;
    await admin(['projects',doomed,'pairings'],{agent_a:a,agent_b:b});
    const tokenA=(await admin(['projects',doomed,'agents',a,'credentials'],{}) as {token:string}).token;
    const tokenB=(await admin(['projects',doomed,'agents',b,'credentials'],{}) as {token:string}).token;
    const sessionA=(await api(tokenA,undefined,'sessions',{})).data.session_id;
    const sessionB=(await api(tokenB,undefined,'sessions',{})).data.session_id;
    const channel=(await api(tokenA,sessionA,'conversations',{recipient_agent_id:b})).data.id;
    const task=(await api(tokenA,sessionA,'tasks',{conversation_id:channel,recipient_agent_id:b,title:'Disposable task',instructions:'Synthetic only'})).data.task.id;
    const sha=createHash('sha256').update('synthetic').digest('hex');
    const transfer=(await api(tokenA,sessionA,'transfers',{conversation_id:channel,direction:'download',manifest:{filename:'fixture.bin',size:9,sha256:sha,sensitivity:'synthetic',parts:[{index:0,offset:0,size:9,sha256:sha}]}})).data.transfer.id;
    await database.query('UPDATE bridge_transfers SET task_id=$2 WHERE id=$1',[transfer,task]);
    await api(tokenA,sessionA,`transfers/${transfer}/offers`,{origin:'https://synthetic.example.test',expires_at:new Date(Date.now()+60000).toISOString(),token:randomBytes(32).toString('base64url')});
    const offer=(await database.query('SELECT current_offer_id FROM bridge_transfers WHERE id=$1',[transfer])).rows[0].current_offer_id;
    expect(offer).toBeTruthy();
    await database.query("INSERT INTO bridge_receipts(id,transfer_id,offer_id,reporter_id,kind,measured_size,measured_sha256,evidence) VALUES($1,$2,$3,$4,'verified',9,$5,'Synthetic fixture')",[randomUUID(),transfer,offer,b,sha]);
    await database.query("INSERT INTO bridge_recipient_keys(agent_id,scheme,public_key,fingerprint) VALUES($1,'age','synthetic','synthetic')",[b]);
    await adminOperation(database,owner,'POST',['projects',doomed,'messages'],{conversation_id:channel,recipient_agent_id:b,body:'Owner fixture'},{key:randomUUID()});
    await adminOperation(database,owner,'POST',['projects',doomed,'tasks',task,'cancel'],{evidence:'Fixture cancellation'},{key:randomUUID()});
    await expect(admin(['projects',doomed,'delete'],{confirm_name:'Delete fixture'},outsider)).rejects.toMatchObject({status:404});
    await expect(admin(['projects',doomed,'delete'],{confirm_name:'Wrong name'})).rejects.toMatchObject({status:422,code:'CONFIRMATION_REQUIRED'});
    expect((await adminOperation(database,owner,'GET',['projects',doomed],null) as any).agents).toHaveLength(2);
    // Clear fixture notifications so this is an empty receiving wait when deletion happens.
    const queued=(await api(tokenB,sessionB,'inbox')).data.messages;
    await api(tokenB,sessionB,'acknowledgements',{message_ids:queued.map((message:{id:string})=>message.id)});
    const pending=api(tokenB,sessionB,'inbox?wait_seconds=2');
    expect(await admin(['projects',doomed,'delete'],{confirm_name:'Delete fixture'})).toEqual({deleted:true,id:doomed});
    expect((await pending).status).toBe(401);
    for(const token of [tokenA,tokenB])expect((await api(token,undefined,'bootstrap')).status).toBe(401);
    await expect(adminOperation(database,owner,'GET',['projects',doomed],null)).rejects.toMatchObject({status:404});
    for(const table of ['bridge_agents','bridge_environments','bridge_messages','bridge_tasks','bridge_transfers','bridge_conversations','bridge_pairings'])expect(Number((await database.query(`SELECT count(*) FROM ${table} WHERE project_id=$1`,[doomed])).rows[0].count)).toBe(0);
    expect(Number((await database.query('SELECT count(*) FROM bridge_offers WHERE transfer_id=$1',[transfer])).rows[0].count)).toBe(0);
    expect(Number((await database.query('SELECT count(*) FROM bridge_receipts WHERE transfer_id=$1',[transfer])).rows[0].count)).toBe(0);
    expect(Number((await database.query('SELECT count(*) FROM bridge_idempotency WHERE actor_id=ANY($1::text[]) OR (actor_id=$2 AND operation=ANY($3::text[]))',[[a,b],owner.id,[`admin/${doomed}/messages`,`admin/tasks/${task}/cancel`]])).rows[0].count)).toBe(0);
    expect((await database.query("SELECT project_id FROM bridge_audit WHERE action='project.delete' AND resource_id=$1",[doomed])).rows).toEqual([{project_id:null}]);
    expect((await adminOperation(database,owner,'GET',['projects',project],null) as any).project.id).toBe(project);
  });
  it('records retrieval only for returned recipient messages, separately from acknowledgement',async()=> {
    const sent=await api(devToken,devSession,'messages',{conversation_id:conversation,recipient_agent_id:deploy,type:'note',body:'Receipt boundary fixture'});
    const id=sent.data.id;
    expect(sent.data.retrieved_at).toBeNull();
    await api(devToken,devSession,`conversations/${conversation}/messages`);
    await adminOperation(database,owner,'GET',['projects',project,'conversations',conversation,'messages'],null);
    expect((await database.query('SELECT retrieved_at FROM bridge_messages WHERE id=$1',[id])).rows[0].retrieved_at).toBeNull();
    const pulled=await api(deployToken,deploySession,`conversations/${conversation}/messages?after_sequence=${Number(sent.data.sequence)-1}&limit=1`);
    expect(pulled.data.messages[0].retrieved_at).toBeTruthy();
    expect(pulled.data.messages[0].acknowledged_at).toBeNull();
    const repeated=await api(deployToken,deploySession,`conversations/${conversation}/messages?after_sequence=${Number(sent.data.sequence)-1}&limit=1`);
    expect(repeated.data.messages[0].retrieved_at).toBe(pulled.data.messages[0].retrieved_at);
    await api(deployToken,deploySession,'acknowledgements',{message_ids:[id]});
  });
  it('M03/M04 re-delivers until exact recipient acknowledges, independently of history',async()=> {
    const first=await api(deployToken,deploySession,'inbox');
    const repeated=await api(deployToken,deploySession,'inbox');
    expect(repeated.data.messages).toEqual(first.data.messages);
    expect(first.data.messages[0].retrieved_at).toBeTruthy();
    expect(first.data.messages[0].acknowledged_at).toBeNull();
    const id=first.data.messages[0].id;
    expect((await api(devToken,devSession,'acknowledgements',{message_ids:[id]})).status).toBe(404);
    for(let i=0;i<2;i++) expect((await api(deployToken,deploySession,'acknowledgements',{message_ids:[id]})).status).toBe(200);
    expect((await api(deployToken,deploySession,'inbox')).data.messages).toHaveLength(0);
    expect((await api(deployToken,deploySession,`conversations/${conversation}/messages`)).data.messages.length).toBeGreaterThan(0);
  });
  it('M05 serializes concurrent sequences without duplicates',async()=> {
    const results=await Promise.all(Array.from({length:12},(_,i)=>api(devToken,devSession,'messages',{conversation_id:conversation,recipient_agent_id:deploy,type:'note',body:`Concurrent ${i}`})));
    expect(results.every(result=>result.status===200)).toBe(true);
    expect(new Set(results.map(result=>result.data.sequence)).size).toBe(12);
  });
  it('M10/T01/T04 creates task+notification atomically and reconciles expired claims',async()=> {
    const body={conversation_id:conversation,recipient_agent_id:deploy,title:'Check synthetic release',instructions:'Do not execute anything.'};
    const key=randomUUID(); const created=await api(devToken,devSession,'tasks',body,key);
    expect((await api(devToken,devSession,'tasks',body,key))).toEqual(created);
    expect(created.data.notification.task_id).toBe(created.data.task.id);
    const id=created.data.task.id;
    const claimed=await api(deployToken,deploySession,`tasks/${id}/claim`,{});
    expect(claimed.data.task.state).toBe('claimed');
    await database.query("UPDATE bridge_tasks SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
    expect((await api(deployToken,deploySession,`tasks/${id}/events`,{type:'completed',evidence:'stale',claim_generation:claimed.data.task.claim_generation})).status).toBe(409);
    expect((await api(deployToken,deploySession,`tasks/${id}/claim`,{})).status).toBe(409);
    const reconciled=await api(deployToken,deploySession,`tasks/${id}/reconcile`,{outcome:'continue',evidence:'Synthetic target unchanged and local lock available.',local_operation_stopped:true});
    expect(reconciled.data.task.claim_generation).toBeGreaterThan(claimed.data.task.claim_generation);
  });
  it('T03/T06 supports explicit reply resume and pause without blocking existing results',async()=> {
    const made=await api(devToken,devSession,'tasks',{conversation_id:conversation,recipient_agent_id:deploy,title:'Question',instructions:'Synthetic task'});
    const id=made.data.task.id;
    let claim=await api(deployToken,deploySession,`tasks/${id}/claim`,{});
    expect((await api(deployToken,deploySession,`tasks/${id}/events`,{type:'question',evidence:'Which version?',local_operation_stopped:true,claim_generation:claim.data.task.claim_generation})).data.task.state).toBe('awaiting_reply');
    claim=await api(deployToken,deploySession,`tasks/${id}/resume`,{evidence:'Reply received; local policy allows synthetic work.',local_operation_stopped:true});
    expect(claim.data.task.state).toBe('claimed');
    await admin(['projects',project,'state'],{state:'paused'});
    expect((await api(devToken,devSession,'tasks',{conversation_id:conversation,recipient_agent_id:deploy,title:'Blocked',instructions:'New task'})).status).toBe(409);
    expect((await api(deployToken,deploySession,`tasks/${id}/events`,{type:'completed',evidence:'Synthetic complete',claim_generation:claim.data.task.claim_generation})).status).toBe(200);
    await admin(['projects',project,'state'],{state:'active'});
  });
  it('M06 replaces the old session automatically and rejects its mutations',async()=> {
    const oldSession=deploySession;
    const replacement=await api(deployToken,undefined,'sessions',{});
    expect(replacement.status).toBe(200);deploySession=replacement.data.session_id;
    expect(deploySession).not.toBe(oldSession);
    expect((await api(deployToken,oldSession,'sessions/current/close',{})).status).toBe(409);
    expect((await api(deployToken,oldSession,'acknowledgements',{message_ids:[randomUUID()]})).status).toBe(409);
    expect((await api(deployToken,oldSession,'sessions',{})).status).toBe(409);
    const grant=await admin(['projects',project,'agents',deploy,'takeover'],{confirm:true}) as {takeover_token:string};
    expect((await api(deployToken,deploySession,'acknowledgements',{message_ids:[randomUUID()]})).status).toBe(409);
    deploySession=(await api(deployToken,undefined,'sessions',{takeover_token:grant.takeover_token})).data.session_id;
    expect(typeof deploySession).toBe('string');
  });
  it('F01/F07 stores encrypted offers, restricts retrieval and purges after receiving verification',async()=> {
    const sha=createHash('sha256').update('synthetic').digest('hex');
    const made=await api(devToken,devSession,'transfers',{conversation_id:conversation,direction:'download',manifest:{filename:'release.bin',size:9,sha256:sha,sensitivity:'synthetic',parts:[{index:0,offset:0,size:9,sha256:sha}]}});
    expect(made.status).toBe(200);const id=made.data.transfer.id;
    const token=randomBytes(32).toString('base64url');
    const input={origin:'https://synthetic-transfer.example.test',expires_at:new Date(Date.now()+60000).toISOString(),token};
    const key=randomUUID();
    expect((await api(deployToken,deploySession,`transfers/${id}/offers`,input)).status).toBe(403);
    const offered=await api(devToken,devSession,`transfers/${id}/offers`,input,key);
    expect(offered.status).toBe(200);expect((await api(devToken,devSession,`transfers/${id}/offers`,input,key))).toEqual(offered);
    const offer=offered.data.offer.id;
    const fetched=await api(deployToken,deploySession,`transfers/${id}/offers/${offer}/credential`,{});
    expect(fetched.data.token).toBe(token);
    expect((await api(foreignToken,foreignSession,`transfers/${id}/offers/${offer}/credential`,{})).status).toBe(404);
    const snapshot=await adminOperation(database,owner,'GET',['projects',project],null);
    expect(JSON.stringify(snapshot)).not.toContain(token);
    const storage=await database.query('SELECT envelope FROM bridge_offers WHERE id=$1',[offer]);
    expect(JSON.stringify(storage.rows)).not.toContain(token);
    const originalReceipt={offer_id:offer,kind:'verified',measured_size:9,measured_sha256:sha,evidence:'Synthetic bytes received and hashed.'};
    expect((await api(devToken,devSession,`transfers/${id}/receipts`,originalReceipt)).status).toBe(403);
    const receiptKey=randomUUID();
    const received=await api(deployToken,deploySession,`transfers/${id}/receipts`,originalReceipt,receiptKey);
    expect(received.status).toBe(200);expect((await api(deployToken,deploySession,`transfers/${id}/receipts`,originalReceipt,receiptKey))).toEqual(received);
    expect((await api(deployToken,deploySession,`transfers/${id}/offers/${offer}/credential`,{})).status).toBe(410);
    expect((await api(devToken,devSession,`transfers/${id}`)).data.transfer.cleanup_state).toBe('pending');
    expect((await api(deployToken,deploySession,`transfers/${id}/events`,{type:'cleanup_confirmed',offer_id:offer,evidence:'Not the host'})).status).toBe(403);
    expect((await api(devToken,devSession,`transfers/${id}/events`,{type:'cleanup_confirmed',offer_id:offer,evidence:'Owned temporary endpoint stopped.'})).status).toBe(200);
  });
  it('F02 separates uploader completion from developer receiving verification',async()=> {
    const sha=createHash('sha256').update('abc').digest('hex');
    const made=await api(deployToken,deploySession,'transfers',{conversation_id:conversation,direction:'upload',manifest:{filename:'return.bin',size:3,sha256:sha,sensitivity:'synthetic',parts:[{index:0,offset:0,size:3,sha256:sha}]}});
    const id=made.data.transfer.id;
    const offered=await api(devToken,devSession,`transfers/${id}/offers`,{origin:'https://synthetic-upload.example.test',expires_at:new Date(Date.now()+60000).toISOString(),token:randomBytes(32).toString('base64url')});
    const receipt={offer_id:offered.data.offer.id,kind:'uploaded',measured_size:3,measured_sha256:sha,evidence:'Parts uploaded.'};
    expect((await api(deployToken,deploySession,`transfers/${id}/receipts`,receipt)).status).toBe(200);
    expect((await api(devToken,devSession,`transfers/${id}`)).data.transfer.state).toBe('awaiting_verification');
    expect((await api(deployToken,deploySession,`transfers/${id}/receipts`,{...receipt,kind:'verified'})).status).toBe(403);
    expect((await api(devToken,devSession,`transfers/${id}/receipts`,{...receipt,kind:'verified',evidence:'Received whole hash measured.'})).status).toBe(200);
    expect((await api(devToken,devSession,`transfers/${id}`)).data.transfer.state).toBe('verified');
  });
  it('F08 rejects sensitive manifests without trusted recipient encryption',async()=> {
    const sha='a'.repeat(64);
    const manifest={filename:'sensitive.age',size:3,sha256:sha,sensitivity:'sensitive',parts:[{index:0,offset:0,size:3,sha256:sha}]};
    expect((await api(devToken,devSession,'transfers',{conversation_id:conversation,direction:'download',manifest})).status).toBe(422);
    expect((await api(devToken,devSession,'transfers',{conversation_id:conversation,direction:'download',manifest:{...manifest,encryption:{scheme:'age',recipient_fingerprint:'b'.repeat(64)}}})).status).toBe(422);
  });
  async function attemptFixture(direction:'download'|'upload'='download') {
    const sha=createHash('sha256').update('abc').digest('hex');
    const created=await api(devToken,devSession,'transfers',{conversation_id:conversation,direction,manifest:{filename:'attempt.bin',size:3,sha256:sha,sensitivity:'synthetic',parts:[{index:0,offset:0,size:3,sha256:sha}]}});
    expect(created.status).toBe(200);
    const id=created.data.transfer.id;
    const offer=async()=> {
      const token=randomBytes(32).toString('base64url');
      const response=await api(devToken,devSession,`transfers/${id}/offers`,{origin:'https://attempt.example.test',expires_at:new Date(Date.now()+60000).toISOString(),token});
      expect(response.status).toBe(200);return {id:response.data.offer.id,token};
    };
    return {id,sha,offer};
  }
  it('F03 keeps replacement offers live after delayed failed or verified receipts',async()=> {
    const {id,sha,offer}=await attemptFixture();
    const old=await offer(),current=await offer();
    for(const kind of ['failed','verified']) {
      const receipt=await api(deployToken,deploySession,`transfers/${id}/receipts`,{offer_id:old.id,kind,measured_size:3,measured_sha256:sha,evidence:'Delayed evidence from superseded endpoint.'});
      expect(receipt.status).toBe(200);expect(receipt.data.applied_to_transfer).toBe(false);
    }
    const metadata=await api(devToken,devSession,`transfers/${id}`);
    expect(metadata.data.transfer).toMatchObject({state:'offered',current_offer_id:current.id,cleanup_state:'pending'});
    expect(metadata.data.receipts).toHaveLength(2);
    expect((await api(deployToken,deploySession,`transfers/${id}/offers/${current.id}/credential`,{})).data.token).toBe(current.token);
  });
  it('F03 does not apply an old uploader receipt to a new upload attempt',async()=> {
    const {id,sha,offer}=await attemptFixture('upload');
    const old=await offer(),current=await offer();
    const receipt=await api(deployToken,deploySession,`transfers/${id}/receipts`,{offer_id:old.id,kind:'uploaded',measured_size:3,measured_sha256:sha,evidence:'Old upload response arrived after replacement.'});
    expect(receipt.data.applied_to_transfer).toBe(false);
    expect((await api(devToken,devSession,`transfers/${id}`)).data.transfer).toMatchObject({state:'offered',current_offer_id:current.id});
  });
  it('F09 records cleanup per endpoint and never closes a replacement endpoint',async()=> {
    const {id,offer}=await attemptFixture();
    const old=await offer(),current=await offer();
    expect((await api(devToken,devSession,`transfers/${id}/events`,{type:'cleanup_confirmed',evidence:'Missing endpoint identity.'})).status).toBe(422);
    expect((await api(devToken,devSession,`transfers/${id}/events`,{type:'cleanup_confirmed',offer_id:randomUUID(),evidence:'Unknown endpoint.'})).status).toBe(404);
    for(const type of ['failed','cancelled','in_progress','cleanup_unknown','cleanup_confirmed']) {
      const recorded=await api(devToken,devSession,`transfers/${id}/events`,{type,offer_id:old.id,evidence:'Historical endpoint event.'});
      expect(recorded.status).toBe(200);expect(recorded.data.applied_to_transfer).toBe(false);
    }
    const metadata=await api(devToken,devSession,`transfers/${id}`);
    expect(metadata.data.transfer).toMatchObject({state:'offered',current_offer_id:current.id,cleanup_state:'pending'});
    expect(metadata.data.offers.find((entry:{id:string})=>entry.id===old.id).cleanup_state).toBe('confirmed');
    expect(metadata.data.offers.find((entry:{id:string})=>entry.id===current.id).cleanup_state).toBe('pending');
    expect((await api(deployToken,deploySession,`transfers/${id}/offers/${current.id}/credential`,{})).data.token).toBe(current.token);
    expect((await api(devToken,devSession,`transfers/${id}/events`,{type:'cleanup_confirmed',offer_id:current.id,evidence:'Current endpoint stopped.'})).data.applied_to_transfer).toBe(true);
    expect((await api(deployToken,deploySession,`transfers/${id}/offers/${current.id}/credential`,{})).status).toBe(410);
  });
  it('F07 accepts late measured verification of the current expired offer with terminal replay protection',async()=> {
    const {id,sha,offer}=await attemptFixture();
    const old=await offer(),current=await offer();
    await database.query("UPDATE bridge_offers SET expires_at=now()-interval '1 second' WHERE id=$1",[current.id]);
    const body={offer_id:current.id,kind:'verified',measured_size:3,measured_sha256:sha,evidence:'Bytes finished before endpoint expiry.'};
    const key=randomUUID();
    const first=await api(deployToken,deploySession,`transfers/${id}/receipts`,body,key);
    expect(first.status).toBe(200);expect(first.data.applied_to_transfer).toBe(true);
    expect(await api(deployToken,deploySession,`transfers/${id}/receipts`,body,key)).toEqual(first);
    expect((await api(deployToken,deploySession,`transfers/${id}/receipts`,body)).status).toBe(409);
    expect((await api(deployToken,deploySession,`transfers/${id}/receipts`,{...body,offer_id:old.id,kind:'failed'})).data.applied_to_transfer).toBe(false);
    expect((await api(devToken,devSession,`transfers/${id}`)).data.transfer.state).toBe('verified');
  });
  it('allows cancellation before an endpoint exists and requires its identity afterward',async()=> {
    const first=await attemptFixture();
    expect((await api(devToken,devSession,`transfers/${first.id}/events`,{type:'cancelled',evidence:'No endpoint was started.'})).data.applied_to_transfer).toBe(true);
    const second=await attemptFixture();
    const current=await second.offer();
    expect((await api(devToken,devSession,`transfers/${second.id}/events`,{type:'cancelled',evidence:'Ambiguous endpoint.'})).status).toBe(422);
    expect((await api(devToken,devSession,`transfers/${second.id}/events`,{type:'cancelled',offer_id:current.id,evidence:'Current endpoint cancelled.'})).status).toBe(200);
    expect((await api(deployToken,deploySession,`transfers/${second.id}/receipts`,{offer_id:current.id,kind:'verified',measured_size:3,measured_sha256:second.sha,evidence:'Too late to change cancellation.'})).status).toBe(409);
  });
  it('rejects manifests and tokens the pinned file helper cannot accept',async()=> {
    const sha=createHash('sha256').update('').digest('hex');
    const manifest={filename:'empty.bin',size:0,sha256:sha,sensitivity:'synthetic',parts:[{index:0,offset:0,size:0,sha256:sha}]};
    for(const invalid of [{...manifest,filename:'x'.repeat(121)},{...manifest,filename:'COM0.bin'},
      {...manifest,parts:[...manifest.parts,{index:1,offset:0,size:0,sha256:sha}]}]) {
      expect((await api(devToken,devSession,'transfers',{conversation_id:conversation,direction:'download',manifest:invalid})).status).toBe(422);
    }
    const valid=await api(devToken,devSession,'transfers',{conversation_id:conversation,direction:'download',manifest});
    expect(valid.status).toBe(200);
    expect((await api(devToken,devSession,`transfers/${valid.data.transfer.id}/offers`,{origin:'https://attempt.example.test',expires_at:new Date(Date.now()+60000).toISOString(),token:'a'.repeat(129)})).status).toBe(422);
  });
  it('issues private kits for both roles, enforces ownership and revokes replacement access',async()=> {
    function files(zip:Buffer) { const out:Record<string,string>={};let n=0;while(zip.readUInt32LE(n)===0x04034b50){const size=zip.readUInt32LE(n+18),length=zip.readUInt16LE(n+26),extra=zip.readUInt16LE(n+28);const name=zip.subarray(n+30,n+30+length).toString();const start=n+30+length+extra;out[name]=zip.subarray(start,start+size).toString();n=start+size;}return out; }
    for(const role of ['development','deployment']) {
      const identity=(await admin(['projects',project,'agents'],{role,environment_id:(await admin(['projects',project,'environments'],{name:'Agent host '+randomUUID()}) as {id:string}).id}) as any).id;
      await expect(ownerTransaction(database,outsider,c=>issueAgentKit(c,outsider,project,identity,{}))).rejects.toThrow();
      const kit=await ownerTransaction(database,owner,c=>issueAgentKit(c,owner,project,identity,{}));
      const contents=files(kit.archive), config=JSON.parse(contents['bridge.config.json']);
      expect(config.agentId).toBe(identity);expect(config.role).toBe(role);
      expect(config.yolo).toBe(true);
      const expectedName=role==='development'?'Developer':'Deployment Agent';
      expect((await api(config.access,undefined,'bootstrap')).data.identity.name).toBe(expectedName);
      expect(contents['workspace/AGENTS.md']).toContain(expectedName);
      expect(contents['Start-Agent.ps1']).toContain("$WindowMode='Normal'");
      expect(contents['workspace/AGENTS.md']).not.toContain(config.access);
      expect(contents['Start-Agent.ps1']).not.toContain(config.access);
      expect(contents['scripts/quiet-session.mjs']).toContain('dynamicTools');
      expect((await api(config.access,undefined,'bootstrap')).status).toBe(200);
      const replacement=await ownerTransaction(database,owner,c=>issueAgentKit(c,owner,project,identity,{rotate:true}));
      expect((await api(config.access,undefined,'bootstrap')).status).toBe(401);
      const replacementConfig=JSON.parse(files(replacement.archive)['bridge.config.json']);
      expect((await api(replacementConfig.access,undefined,'bootstrap')).status).toBe(200);
      const audit=(await database.query('SELECT * FROM bridge_audit WHERE resource_id=$1',[identity])).rows;
      expect(JSON.stringify(audit)).not.toContain(config.access);
    }
  });
  it('A05 stops a pending inbox from releasing data after key revocation',async()=> {
    const pending=await api(deployToken,deploySession,'inbox');
    if(pending.data.messages.length) await api(deployToken,deploySession,'acknowledgements',{message_ids:pending.data.messages.map((m:{id:string})=>m.id)});
    const waiting=api(deployToken,deploySession,'inbox?wait_seconds=3');
    await new Promise(resolve=>setTimeout(resolve,100));
    const credentialId=deployToken.slice(4).split('.')[0];
    await admin(['projects',project,'credentials',credentialId,'revoke'],{});
    expect((await waiting).status).toBe(401);
  });
  it('A06 enforces expiry, rotation and owner suspension for agent access',async()=> {
    const expired=newCredential();
    await database.query("INSERT INTO bridge_credentials(id,agent_id,digest,expires_at) VALUES($1,$2,$3,now()-interval '1 second')",[expired.id,dev,expired.digest]);
    expect((await api(expired.token,undefined,'bootstrap')).status).toBe(401);
    const next=await admin(['projects',project,'agents',dev,'credentials'],{rotate:true});
    expect((await api(devToken,undefined,'bootstrap')).status).toBe(401);
    expect((await api((next as {token:string}).token,undefined,'bootstrap')).status).toBe(200);
    await database.query('UPDATE bridge_owner_state SET active=false WHERE owner_id=$1',[owner.id]);
    expect((await api((next as {token:string}).token,undefined,'bootstrap')).status).toBe(401);
  });
});
