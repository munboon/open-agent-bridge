import {promptTemplateIds,roleWorkInstructions} from '../src/lib/agent-instructions';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { provisionProject as configuredProject } from '../src/lib/project-kit';
import {createRoleKit} from '../src/lib/role-kits';
import * as kits from '../src/lib/agent-kit';
import { adminOperation, ownerTransaction } from '../src/lib/admin-service';
import { handleAgentRequest } from '../src/lib/agent-api';

// Existing kit tests intentionally request this explicit two-agent fixture.
const pair=[{name:'Development',agents:[{name:'Developer',prompt_template:'development'}]},{name:'Deployment',agents:[{name:'Deployment Agent',prompt_template:'deployment'}]}];
const provisionProject=(database:Pool,owner:{id:string;email:string},body:Record<string,unknown>)=>configuredProject(database,owner,{...body,environments:pair},randomUUID());

describe.skipIf(!process.env.TEST_DATABASE_URL)('configured portal provisioning', () => {
  let database: Pool;
  const owner = { id: randomUUID(), email: `provision-${randomUUID()}@example.test` };
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55442' || url.pathname !== '/oab_test') throw Error('Isolated test DB required');
    database = new Pool({ connectionString: url.toString() });
    await database.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())', [owner.id,'Synthetic provisioning',owner.email]);
    await database.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)', [owner.id]);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    const projects = await database.query('SELECT id,name FROM bridge_projects WHERE owner_id=$1', [owner.id]);
    for (const project of projects.rows) await adminOperation(database,owner,'POST',['projects',project.id,'delete'],{confirm_name:project.name});
    await database.query('DELETE FROM bridge_audit WHERE owner_id=$1', [owner.id]);
    await database.query('DELETE FROM bridge_owner_state WHERE owner_id=$1', [owner.id]);
    await database.query('DELETE FROM "user" WHERE id=$1', [owner.id]);
    await database.end();
  });
  it('creates only explicitly named environments and agents and safely retries setup',async()=>{
    const input={name:'Research team',client_label:'Synthetic',environments:[{name:'Office',agents:[{name:'Analyst',prompt_template:'discovery'},{name:'Reviewer',prompt_template:'discovery'}]},{name:'Archive',agents:[{name:'Archivist',prompt_template:'discovery'}]}]};
    const key=randomUUID();const result=await configuredProject(database,owner,input,key);expect(await configuredProject(database,owner,input,key)).toEqual(result);
    const environments=(await database.query('SELECT name FROM bridge_environments WHERE project_id=$1 ORDER BY name',[result.projectId])).rows;expect(environments.map(e=>e.name)).toEqual(['Archive','Office']);
    const agents=(await database.query('SELECT name,prompt_template FROM bridge_agents WHERE project_id=$1 ORDER BY name',[result.projectId])).rows;expect(agents.map(a=>a.name)).toEqual(['Analyst','Archivist','Reviewer']);expect(agents.every(a=>a.prompt_template==='discovery')).toBe(true);
    await expect(configuredProject(database,owner,{name:'Incomplete',client_label:'Synthetic'},randomUUID())).rejects.toThrow();
    await expect(configuredProject(database,owner,{...input,environments:[input.environments[0],input.environments[0]]},randomUUID())).rejects.toThrow();
    const environment=await adminOperation(database,owner,'POST',['projects',result.projectId,'environments'],{name:'Empty environment',create_agent:false}) as any;
    expect((await database.query('SELECT id FROM bridge_agents WHERE environment_id=$1',[environment.id])).rowCount).toBe(0);
  });
  it('assigns stable short portal IDs and enforces project scope when resolving threads',async()=>{
    const {projectId}=await provisionProject(database,owner,{name:'Portal addresses',client_label:'Synthetic'});
    const snap:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    expect(snap.project.public_id).toMatch(/^[a-f0-9]{10}$/);
    expect(snap.agents[0].public_id).toMatch(/^[a-f0-9]{10}$/);
    const token='a'+snap.agents[0].public_id;
    expect(await adminOperation(database,owner,'GET',['projects',projectId,'portal-thread',token],null)).toEqual({selection:'owner:'+snap.agents[0].id});
    const other=await provisionProject(database,owner,{name:'Other address',client_label:'Synthetic'});
    await expect(adminOperation(database,owner,'GET',['projects',other.projectId,'portal-thread',token],null)).rejects.toMatchObject({status:404});
    await database.query('UPDATE bridge_projects SET name=$2 WHERE id=$1',[projectId,'Renamed']);
    expect((await adminOperation(database,owner,'GET',['projects',projectId],null) as any).project.public_id).toBe(snap.project.public_id);
  });
  it('bakes the hide checkbox into regenerated Codex configs and remembers the choice',async()=>{
    const {projectId}=await provisionProject(database,owner,{name:'Display checkbox',client_label:'Synthetic'});
    const snapshot:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    const agent=snapshot.agents.find((a:any)=>a.role==='deployment');
    for(const hide of [true,false]){
      const kit=await ownerTransaction(database,owner,client=>kits.issueAgentKit(client,owner,projectId,agent.id,{hide_messages:hide}));
      const script="import io,json,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps({'chatVisible':json.loads(z.read('bridge.config.json'))['chatVisible']}))";
      const config=JSON.parse(execFileSync('python3',['-c',script],{input:kit.archive}).toString());
      expect(config.chatVisible).toBe(!hide);
      const updated:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
      expect(updated.agents.find((a:any)=>a.id===agent.id).chat_visible).toBe(!hide);
    }
    await ownerTransaction(database,owner,client=>kits.issueAgentKit(client,owner,projectId,agent.id,{format:'third-party',hide_messages:true}));
    const unchanged:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    expect(unchanged.agents.find((a:any)=>a.id===agent.id).chat_visible).toBe(true);
  });
  it('prepares 60-day credentials without downloads, then releases each config independently', async () => {
    const start = Date.now();
    const result = await provisionProject(database, owner, {name:'Ready project',client_label:'Synthetic'});
    expect(Object.keys(result)).toEqual(['projectId']);
    const snapshot:any = await adminOperation(database,owner,'GET',['projects',result.projectId],null);
    expect(snapshot.environments).toHaveLength(2);
    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.agents.every((a:any)=>a.active)).toBe(true);
    expect(snapshot.agents.map((a:any)=>a.name).sort()).toEqual(['Deployment Agent','Developer']);
    expect(snapshot.credentials).toHaveLength(2);
    expect(snapshot.credentials.every((c:any)=>c.download_pending)).toBe(true);
    expect(snapshot.agents.every((a:any)=>a.status.provisioned)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('kit_envelope');
    const configs:any[] = [];
    for (const role of ['development', 'deployment']) {
      const agent = snapshot.agents.find((a:any)=>a.role===role);
      const encryptedBefore=(await database.query('SELECT kit_envelope FROM bridge_credentials WHERE agent_id=$1',[agent.id])).rows[0].kit_envelope;
      const kit = await ownerTransaction(database,owner,client=>kits.issueAgentKit(client,owner,result.projectId,agent.id,{expires_days:60}));
      const script = `import io,json,sys,zipfile
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
assert 'GNU GENERAL PUBLIC LICENSE' in z.read('LICENSE').decode()
assert 'Mun Boon' in z.read('NOTICE.txt').decode()
assert 'GPL-3.0-only' in z.read('NOTICE.txt').decode()
assert 'Permission is hereby granted' in z.read('scripts/ws.LICENSE').decode()
assert 'scripts/kit-workspace.mjs' in z.namelist()
assert 'Start-Agent.sh' in z.namelist()
assert 'Start-Agent.bat' in z.namelist()
assert 'powershell.exe' in z.read('Start-Agent.bat').decode()
assert '%~dp0Start-Agent.ps1' in z.read('Start-Agent.bat').decode()
assert 'scripts/kit-tui.mjs' in z.namelist()
assert 'scripts/ws.cjs' in z.namelist()
print(z.read('bridge.config.json').decode())`;
      const config = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3',['-c',script],{input:kit.archive}).toString());
      const preview:any=await adminOperation(database,owner,'GET',['projects',result.projectId,'agents',agent.id,'instructions'],null);
      const instructions=execFileSync(process.platform==='win32'?'python':'python3',['-c',"import io,sys,zipfile;print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('workspace/AGENTS.md').decode(),end='')"],{input:kit.archive}).toString();
      expect(preview.instructions).toBe(instructions);
      expect(preview.runtime).toContain('Use bridge_request');
      expect(preview.startup).toContain(agent.name);
      expect(JSON.stringify(preview)).not.toContain(config.access);
      await expect(adminOperation(database,{id:randomUUID(),email:'other@example.test'},'GET',['projects',result.projectId,'agents',agent.id,'instructions'],null)).rejects.toThrow();

      expect(JSON.stringify(encryptedBefore)).not.toContain(config.access);
      expect((await database.query('SELECT kit_envelope FROM bridge_credentials WHERE agent_id=$1',[agent.id])).rows[0].kit_envelope).toBeNull();
      configs.push(config);
      expect(config.role).toBe(role);
      expect(config.chatVisible).toBe(role==='development');
      expect(config.promptWorkingDirectory).toBe(true);
      expect(config.instructionsPath).toBe('workspace/AGENTS.md');
      expect(config.projectId).toBe(result.projectId);
      expect(Date.parse(config.expiresAt)-start).toBeGreaterThanOrEqual(60*86400000);
      expect(Date.parse(config.expiresAt)-start).toBeLessThan(60*86400000+10000);
      const response = await handleAgentRequest(new Request('http://127.0.0.1/api/v1/bootstrap',{headers:{authorization:`Bearer ${config.access}`}}),database);
      expect(response.status).toBe(200);
      const updated:any = await adminOperation(database,owner,'GET',['projects',result.projectId],null);
      expect(updated.credentials).toHaveLength(2);
      expect(updated.credentials.filter((c:any)=>c.download_pending)).toHaveLength(2-configs.length);
      for (const c of configs) expect(JSON.stringify(updated)).not.toContain(c.access);
    }
    expect(configs[0].access).not.toBe(configs[1].access);
  });
  it('does not package kits during creation', async () => {
    const spy = vi.spyOn(kits,'issueAgentKit').mockRejectedValue(Error('Synthetic packaging failure'));
    try {
      const result = await provisionProject(database,owner,{name:'No download project',client_label:'Synthetic'});
      expect(spy).not.toHaveBeenCalled();
      expect((await database.query('SELECT id FROM bridge_projects WHERE id=$1',[result.projectId])).rowCount).toBe(1);
    } finally { spy.mockRestore(); }
  });
  it('connects office, UAT and production peers and carries renamed identities into kits', async () => {
    const {projectId} = await provisionProject(database,owner,{name:'Environment network',client_label:'Synthetic'});
    const admin = (path:string[],body:unknown) => adminOperation(database,owner,'POST',['projects',projectId,...path],body);
    const initial:any = await adminOperation(database,owner,'GET',['projects',projectId],null);
    const developer = initial.agents.find((a:any)=>a.role==='development');
    const uat = initial.agents.find((a:any)=>a.role==='deployment');
    const env:any = await admin(['environments'],{name:'Production'});
    const afterEnv:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    const production:any=afterEnv.agents.find((a:any)=>a.environment_id===env.id);
    expect(production.name).toBe('Production Agent');
    expect(production.status.provisioned).toBe(true);
    await admin(['agents',production.id,'name'],{name:'Production Deployment'});
    await admin(['agents',developer.id,'name'],{name:'Open Developer'});
    await admin(['agents',uat.id,'name'],{name:'UAT Deployment'});
    const reviewer:any=await admin(['agents'],{name:'Production reviewer',role:'development',environment_id:env.id});
    const entries:any[]=[];
    const call = async (token:string,session:string|undefined,path:string,body?:unknown) => {
      const response = await handleAgentRequest(new Request('http://127.0.0.1/api/v1/'+path,{
        method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,...(session?{'X-Bridge-Session':session}:{}),'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body===undefined?undefined:JSON.stringify(body),
      }),database);
      expect(response.status).toBe(200);return response.json();
    };
    for(const [agent,name] of [[developer,'Open Developer'],[uat,'UAT Deployment'],[production,'Production Deployment'],[reviewer,'Production reviewer']] as const) {
      const kit=await ownerTransaction(database,owner,client=>kits.issueAgentKit(client,owner,projectId,agent.id,{}));
      const script=`import io,sys,zipfile
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert 'WindowTitle' in z.read('Start-Agent.ps1').decode()
print(z.read('bridge.config.json').decode())`;
      const config=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-c',script],{input:kit.archive}).toString());
      expect(config.name).toBe(name);
      expect((await call(config.access,undefined,'bootstrap')).identity.name).toBe(name);
      const session=(await call(config.access,undefined,'sessions',{})).session_id;
      entries.push({id:agent.id,token:config.access,session});
    }
    for(const entry of entries) {
      const peers=(await call(entry.token,entry.session,'peers')).peers;
      expect(peers.map((p:any)=>p.id).sort()).toEqual(entries.filter(e=>e.id!==entry.id).map(e=>e.id).sort());
      expect(peers.every((p:any)=>p.environment_id && p.environment_name)).toBe(true);
    }
    const [office,u,p]=entries;
    const conversation=await call(u.token,u.session,'conversations',{recipient_agent_id:p.id});
    const sent=await call(u.token,u.session,'messages',{conversation_id:conversation.id,recipient_agent_id:p.id,type:'note',body:'UAT verification complete'});
    expect((await call(p.token,p.session,'inbox?wait_seconds=0')).messages.map((m:any)=>m.id)).toContain(sent.id);
    await admin(['agents',developer.id,'name'],{name:'Renamed Office'});
    expect((await call(office.token,undefined,'bootstrap')).identity.name).toBe('Renamed Office');
    await admin(['agents',production.id,'state'],{active:false});
    const replacement:any=await admin(['agents'],{name:'Production replacement',role:'deployment',environment_id:env.id});
    await admin(['agents',production.id,'state'],{active:true});
    const together:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    expect(together.agents.filter((agent:any)=>agent.environment_id===env.id&&agent.active)).toHaveLength(3);
    await admin(['agents',replacement.id,'state'],{active:false});
    await admin(['agents',production.id,'state'],{active:true});
  });
  it('rolls back environment and agent creation if access cannot be encrypted', async () => {
    const {projectId}=await provisionProject(database,owner,{name:'Atomic environment',client_label:'Synthetic'});
    const original=process.env.BRIDGE_ENVELOPE_KEY;
    delete process.env.BRIDGE_ENVELOPE_KEY;
    try {
      await expect(adminOperation(database,owner,'POST',['projects',projectId,'environments'],{name:'No partial environment'})).rejects.toMatchObject({code:'ENVELOPE_UNCONFIGURED'});
      expect((await database.query('SELECT id FROM bridge_environments WHERE project_id=$1 AND name=$2',[projectId,'No partial environment'])).rowCount).toBe(0);
    } finally {if(original!==undefined)process.env.BRIDGE_ENVELOPE_KEY=original;}
  });
  it('saves isolated agent prompts across exports, rejects stale edits and restores templates', async () => {
    const {projectId}=await provisionProject(database,owner,{name:'Prompt editing',client_label:'Synthetic'});
    const snapshot:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    const agent=snapshot.agents[0],peer=snapshot.agents[1];
    const path=['projects',projectId,'agents',agent.id,'instructions'];
    const initial:any=await adminOperation(database,owner,'GET',path,null);
    expect(initial.templates.map((t:any)=>t.id)).toEqual([...promptTemplateIds]);
    const text='Inspect the selected project folder. Report verified inventory. Do not change services.';
    const appearance={icon:'shield',color:'teal',image:null};
    const saved:any=await adminOperation(database,owner,'POST',path,{appearance,name:'Site assessment',chat_visible:true,prompt_template:'discovery',work_instructions:text,expected_revision:0});
    expect(saved).toMatchObject({name:'Site assessment',chat_visible:true,work_instructions:text,customized:true,revision:1,prompt_template:'discovery'});
    expect(saved.appearance).toEqual(appearance);
    expect((await adminOperation(database,owner,'GET',['projects',projectId],null) as any).agents.find((a:any)=>a.id===agent.id).appearance).toEqual(appearance);
    expect(saved.instructions).toContain(text);
    expect(saved.instructions).toContain('The adapter owns authentication');
    expect((await database.query('SELECT role FROM bridge_agents WHERE id=$1',[agent.id])).rows[0].role).toBe(agent.role);
    expect(await adminOperation(database,owner,'GET',path,null)).toEqual(saved);
    await expect(adminOperation(database,owner,'POST',path,{prompt_template:'development',work_instructions:'Lost edit',expected_revision:0})).rejects.toMatchObject({code:'INSTRUCTIONS_CHANGED'});
    await expect(adminOperation(database,owner,'POST',path,{prompt_template:'discovery',work_instructions:' ',expected_revision:1})).rejects.toThrow();
    await expect(adminOperation(database,owner,'POST',path,{prompt_template:'discovery',work_instructions:'x'.repeat(16001),expected_revision:1})).rejects.toThrow();
    await expect(adminOperation(database,{id:randomUUID(),email:'outsider@example.test'},'POST',path,{prompt_template:'discovery',work_instructions:text,expected_revision:1})).rejects.toThrow();
    const other=await provisionProject(database,owner,{name:'Other prompt project',client_label:'Synthetic'});
    await expect(adminOperation(database,owner,'POST',['projects',other.projectId,'agents',agent.id,'instructions'],{prompt_template:'discovery',work_instructions:text,expected_revision:1})).rejects.toThrow();
    expect((await adminOperation(database,owner,'GET',['projects',projectId,'agents',peer.id,'instructions'],null) as any).customized).toBe(false);
    const kit=await ownerTransaction(database,owner,client=>kits.issueAgentKit(client,owner,projectId,agent.id,{}));
    const instructions=execFileSync(process.platform==='win32'?'python':'python3',['-c',"import io,sys,zipfile;print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('workspace/AGENTS.md').decode(),end='')"],{input:kit.archive}).toString();
    expect(instructions).toBe(saved.instructions);
    const config=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-c',"import io,sys,zipfile;print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('bridge.config.json').decode(),end='')"],{input:kit.archive}).toString());
    expect(config.name).toBe('Site assessment');
    expect(config.chatVisible).toBe(true);
    expect((await adminOperation(database,owner,'GET',path,null) as any).revision).toBe(1);

    const thirdParty=await ownerTransaction(database,owner,client=>kits.issueAgentKit(client,owner,projectId,agent.id,{format:'third-party'}));
    expect(thirdParty.archive.toString()).toContain(text);
    expect(await ownerTransaction(database,owner,client=>createRoleKit(client,owner,projectId,agent.id))).toContain(text);
    const restored:any=await adminOperation(database,owner,'POST',path,{prompt_template:'deployment',work_instructions:null,expected_revision:1});
    expect(restored).toMatchObject({customized:false,revision:2,prompt_template:'deployment'});
    expect(restored.work_instructions).toBe(restored.default_instructions);
    expect(restored.instructions).not.toContain(text);
  });
  it('persists editable templates at creation and exports the exact custom instructions',async()=>{
    const text='Plan support operations. Escalate unresolved incidents to the named engineering peer.';
    const configured=promptTemplateIds.map(template=>({name:template,prompt_template:template,work_instructions:template==='custom'?text:roleWorkInstructions(template)+'\nReport the assigned ticket ID.'}));
    const {projectId}=await configuredProject(database,owner,{name:'All templates',client_label:'Synthetic',environments:[{name:'Office',agents:configured}]},randomUUID());
    const rows=(await database.query('SELECT id,name,prompt_template,work_instructions FROM bridge_agents WHERE project_id=$1',[projectId])).rows;
    expect(rows).toHaveLength(configured.length);
    for(const agent of rows){
      expect(agent.work_instructions).toBe(configured.find(a=>a.name===agent.name)!.work_instructions);
      const preview:any=await adminOperation(database,owner,'GET',['projects',projectId,'agents',agent.id,'instructions'],null);
      expect(preview.instructions).toContain(agent.work_instructions);
      expect(await ownerTransaction(database,owner,client=>createRoleKit(client,owner,projectId,agent.id))).toContain(agent.work_instructions);
    }
    const snapshot:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    const extra:any=await adminOperation(database,owner,'POST',['projects',projectId,'agents'],{environment_id:snapshot.environments[0].id,name:'Extra support',prompt_template:'support_l2',work_instructions:text});
    expect((await adminOperation(database,owner,'GET',['projects',projectId,'agents',extra.id,'instructions'],null) as any).work_instructions).toBe(text);
    await expect(configuredProject(database,owner,{name:'No purpose',client_label:'Synthetic',environments:[{name:'Office',agents:[{name:'Blank',prompt_template:'custom'}]}]},randomUUID())).rejects.toThrow();
    await expect(adminOperation(database,owner,'POST',['projects',projectId,'agents'],{environment_id:snapshot.environments[0].id,name:'Blank',prompt_template:'custom'})).rejects.toThrow();
    await expect(adminOperation(database,owner,'POST',['projects',projectId,'agents',extra.id,'instructions'],{prompt_template:'custom',work_instructions:null,expected_revision:0})).rejects.toThrow();
  });
  it('creates discovery agents and environment agents with portable template defaults', async () => {
    const {projectId}=await provisionProject(database,owner,{name:'Discovery templates',client_label:'Synthetic'});
    const environment:any=await adminOperation(database,owner,'POST',['projects',projectId,'environments'],{name:'Assessment',prompt_template:'discovery'});
    const created:any=await adminOperation(database,owner,'POST',['projects',projectId,'agents'],{environment_id:environment.id,prompt_template:'discovery'});
    expect(created).toMatchObject({name:'General purpose Agent',prompt_template:'discovery'});
    const snapshot:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    for(const agent of snapshot.agents.filter((a:any)=>a.environment_id===environment.id)) {
      expect(agent.prompt_template).toBe('discovery');
      const preview:any=await adminOperation(database,owner,'GET',['projects',projectId,'agents',agent.id,'instructions'],null);
      expect(preview.work_instructions).toContain('Do not assume a deployment assignment');
      expect(preview.instructions).not.toMatch(/[A-Z]:\\|Start-Agent\.ps1|ListAgents|SendMessage/);
    }
  });
  it('clears pending config access when credentials are revoked', async () => {
    const {projectId}=await provisionProject(database,owner,{name:'Revoked pending configs',client_label:'Synthetic'});
    const snapshot:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    const credential=snapshot.credentials[0];
    await adminOperation(database,owner,'POST',['projects',projectId,'credentials',credential.id,'revoke'],{});
    expect((await database.query('SELECT kit_envelope FROM bridge_credentials WHERE id=$1',[credential.id])).rows[0].kit_envelope).toBeNull();
  });
  it('extends project credentials once, including expired access, without reviving revoked or disabled access', async () => {
    const {projectId}=await provisionProject(database,owner,{name:'Validity extension',client_label:'Synthetic'});
    const other=await provisionProject(database,owner,{name:'Other validity',client_label:'Synthetic'});
    const snapshot:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    const [first,second]=snapshot.credentials;
    const revoked:any=await adminOperation(database,owner,'POST',['projects',projectId,'agents',first.agent_id,'credentials'],{});
    await adminOperation(database,owner,'POST',['projects',projectId,'credentials',revoked.id,'revoke'],{});
    await adminOperation(database,owner,'POST',['projects',projectId,'agents',second.agent_id,'state'],{active:false});
    await database.query("UPDATE bridge_credentials SET expires_at=now()-interval '1 day' WHERE id=$1",[first.id]);
    const before=(await database.query('SELECT id,expires_at,revoked_at FROM bridge_credentials WHERE agent_id=ANY($1::uuid[])',[snapshot.agents.map((a:any)=>a.id)])).rows;
    const otherBefore:any=await adminOperation(database,owner,'GET',['projects',other.projectId],null);
    const path=['projects',projectId,'extend-validity'],key=randomUUID(),start=Date.now();
    const extend=()=>adminOperation(database,owner,'POST',path,{days:30},{key});
    const results=await Promise.all([extend(),extend()]);
    expect(results[0]).toMatchObject({days:30,agents_extended:2,credentials_extended:2,agents_skipped:0});
    expect(results[1]).toEqual(results[0]);
    const after:any=await adminOperation(database,owner,'GET',['projects',projectId],null);
    const expiry=(id:string)=>new Date(after.credentials.find((c:any)=>c.id===id).expires_at).getTime();
    expect(expiry(first.id)).toBeGreaterThanOrEqual(start+30*86400000);
    expect(expiry(first.id)).toBeLessThan(Date.now()+30*86400000+1000);
    expect(expiry(second.id)).toBe(new Date(before.find(c=>c.id===second.id).expires_at).getTime()+30*86400000);
    expect(expiry(revoked.id)).toBe(new Date(before.find(c=>c.id===revoked.id).expires_at).getTime());
    expect(after.credentials.find((c:any)=>c.id===revoked.id).revoked_at).toBeTruthy();
    expect(after.agents.find((a:any)=>a.id===second.agent_id).active).toBe(false);
    expect(after.credentials.find((c:any)=>c.id===second.id).download_pending).toBe(true);
    const otherAfter:any=await adminOperation(database,owner,'GET',['projects',other.projectId],null);
    expect(otherAfter.credentials).toEqual(otherBefore.credentials);
    await expect(adminOperation(database,owner,'POST',path,{days:0},{key:randomUUID()})).rejects.toThrow();
    await expect(adminOperation(database,owner,'POST',path,{days:31},{key})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    await expect(adminOperation(database,{id:randomUUID(),email:'outsider@example.test'},'POST',path,{days:30},{key:randomUUID()})).rejects.toThrow();
  });
  it('rejects disabled owners before creating any project', async () => {
    await database.query('UPDATE bridge_owner_state SET active=false WHERE owner_id=$1',[owner.id]);
    try {
      await expect(provisionProject(database,owner,{name:'Forbidden project',client_label:'Synthetic'})).rejects.toThrow();
      expect((await database.query('SELECT id FROM bridge_projects WHERE owner_id=$1 AND name=$2',[owner.id,'Forbidden project'])).rowCount).toBe(0);
    } finally { await database.query('UPDATE bridge_owner_state SET active=true WHERE owner_id=$1',[owner.id]); }
  });
});
