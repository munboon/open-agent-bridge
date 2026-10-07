import {randomUUID,generateKeyPairSync,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {adminOperation,ownerTransaction} from '../src/lib/admin-service';
import {issueEnrollment} from '../src/lib/agent-enrollment';
import {issueAgentKit} from '../src/lib/agent-kit';
import {prepareAgentAccess} from '../src/lib/kit-access';
import {handleAgentRequest} from '../src/lib/agent-api';
import {signedHeaders} from '../scripts/bridge-client.mjs';
import {recordAttempt} from '../src/lib/agent-auth';

describe.skipIf(!process.env.TEST_DATABASE_URL)('unlimited access PostgreSQL regressions',()=>{
  let db:Pool,project:string,otherProject:string;
  const owner={id:randomUUID(),email:randomUUID()+'@example.test'};
  const oldEnvelope=process.env.BRIDGE_ENVELOPE_KEY;
  const admin=(path:string[],body:unknown={},key?:string)=>adminOperation(db,owner,'POST',path,body,{key});
  const snapshot=(id=project)=>adminOperation(db,owner,'GET',['projects',id],null) as Promise<any>;
  const transaction=<T,>(work:Parameters<typeof ownerTransaction<T>>[2])=>ownerTransaction(db,owner,work);
  async function agent(projectId=project){
    const env:any=await admin(['projects',projectId,'environments'],{name:'Host '+randomUUID(),create_agent:false});
    const a:any=await admin(['projects',projectId,'agents'],{name:'Synthetic agent',environment_id:env.id});return a.id as string;
  }
  async function call(config:any,path:string,body?:unknown,overrides:Record<string,string>={}){
    const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),key=randomUUID();
    const headers=config.privateKey?signedHeaders(config,method,'/api/v1/'+path,raw,key):{authorization:'Bearer '+config.token,'Content-Type':'application/json','Idempotency-Key':key,...(config.session?{'X-Bridge-Session':config.session}:{})};
    const response=await handleAgentRequest(new Request('http://127.0.0.1/api/v1/'+path,{method,headers:{...headers,...overrides},body:body===undefined?undefined:raw}),db);
    return {status:response.status,data:await response.json()};
  }
  async function portable(expires_days:number|null=null,existingId?:string){
    const agentId=existingId??await agent();const setup=await transaction(c=>issueEnrollment(c,owner,project,agentId,{expires_days,replace:!!existingId}));
    const keys=generateKeyPairSync('ed25519');
    return {setup,agentId,origin:'http://127.0.0.1',token:/Enrollment code: (\S+)/.exec(setup.prompt)![1],device:{os:'linux',machine:'a'.repeat(64),installation:randomUUID()},privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:keys.publicKey.export({format:'pem',type:'spki'})};
  }
  async function claim(c:any){expect((await call(c,'enrollments/claim',{public_key:c.publicKey})).status).toBe(200);const challenge=await call(c,'sessions/challenge',{});const session=await call(c,'sessions',{challenge:challenge.data.challenge});expect(session.status).toBe(200);c.session=session.data.session_id;}
  function unzip(archive:Buffer){return JSON.parse(execFileSync('python3',['-c',"import io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({'config':json.loads(z.read('bridge.config.json')),'readme':z.read('README.md').decode()}))"],{input:archive}).toString());}
  beforeAll(async()=>{
    const url=new URL(process.env.TEST_DATABASE_URL!);if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test')throw Error('Isolated test DB required');
    db=new Pool({connectionString:url.toString()});process.env.BRIDGE_ENVELOPE_KEY=randomBytes(32).toString('base64');
    await db.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[owner.id,'Synthetic unlimited tests',owner.email]);
    await db.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)',[owner.id]);
    project=(await admin(['projects'],{name:'Unlimited tests',client_label:'Synthetic'}) as any).id;
    otherProject=(await admin(['projects'],{name:'Other duration tests',client_label:'Synthetic'}) as any).id;
  });
  afterAll(async()=>{
    if(db){for(const p of (await db.query('SELECT id,name FROM bridge_projects WHERE owner_id=$1',[owner.id])).rows)await admin(['projects',p.id,'delete'],{confirm_name:p.name});
      await db.query('DELETE FROM bridge_idempotency WHERE actor_id=$1',[owner.id]);await db.query('DELETE FROM bridge_audit WHERE owner_id=$1',[owner.id]);await db.query('DELETE FROM bridge_owner_state WHERE owner_id=$1',[owner.id]);await db.query('DELETE FROM "user" WHERE id=$1',[owner.id]);await db.end();}
    if(oldEnvelope===undefined)delete process.env.BRIDGE_ENVELOPE_KEY;else process.env.BRIDGE_ENVELOPE_KEY=oldEnvelope;
  });
  it('preserves finite defaults and rejects malformed duration without issuing credentials',async()=>{
    const id=await agent(),start=Date.now();
    const raw:any=await admin(['projects',project,'agents',id,'credentials']);expect(raw.expires_at.getTime()).toBeGreaterThan(start+29*86400000);expect(raw.expires_at.getTime()).toBeLessThan(start+31*86400000);
    const setup=await transaction(c=>issueEnrollment(c,owner,project,id,{}));expect(Date.parse(setup.access_expires_at!)).toBeGreaterThan(start+59*86400000);
    const kit=unzip((await transaction(c=>issueAgentKit(c,owner,project,id,{}))).archive);expect(Date.parse(kit.config.expiresAt)).toBeGreaterThan(start+59*86400000);
    const before=(await snapshot()).credentials.length;
    for(const value of ['', 'unlimited',0,91,1.5]){
      await expect(admin(['projects',project,'agents',id,'credentials'],{expires_days:value})).rejects.toThrow();
      await expect(transaction(c=>issueEnrollment(c,owner,project,id,{expires_days:value}))).rejects.toThrow();
      await expect(transaction(c=>issueAgentKit(c,owner,project,id,{expires_days:value}))).rejects.toThrow();
      await expect(admin(['projects',project,'extend-validity'],{days:value},randomUUID())).rejects.toThrow();
    }
    expect((await snapshot()).credentials.length).toBe(before);
  });
  it('claims unlimited access with independent 30-minute setup deadline and preserves proofs and device binding',async()=>{
    const c:any=await portable(),now=Date.now();expect(c.setup.access_expires_at).toBeNull();expect(Date.parse(c.setup.expires_at)-now).toBeGreaterThan(29*60000);expect(Date.parse(c.setup.expires_at)-now).toBeLessThanOrEqual(30*60000);expect(c.setup.prompt).toContain('Unlimited (until revoked)');
    expect((await call(c,'bootstrap')).status).toBe(401);await claim(c);expect((await call(c,'bootstrap')).status).toBe(200);
    expect((await call(c,'bootstrap',undefined,{'X-Bridge-Proof':''})).status).toBe(401);
    expect((await call({...c,device:{...c.device,machine:'b'.repeat(64)}},'bootstrap')).status).toBe(403);
    expect((await call({...c,session:randomUUID()},'peers')).status).toBe(409);
    expect((await snapshot()).agents.find((a:any)=>a.id===c.agentId).status.provisioned).toBe(true);
    await db.query("UPDATE bridge_credentials SET enrollment_expires_at=now()-interval '1 second' WHERE agent_id=$1",[c.agentId]);expect((await call(c,'bootstrap')).status).toBe(200);
    const expired:any=await portable();await db.query("UPDATE bridge_credentials SET enrollment_expires_at=now()-interval '1 second' WHERE agent_id=$1",[expired.agentId]);expect((await call(expired,'enrollments/claim',{public_key:expired.publicKey})).status).toBe(410);
  });
  it('keeps replacement-on-claim and session fencing for unlimited installations',async()=>{
    const old:any=await portable();await claim(old);const fresh:any=await portable(null,old.agentId);
    expect((await call(old,'peers')).status).toBe(200);await claim(fresh);expect((await call(old,'peers')).status).toBe(401);expect((await call(fresh,'peers')).status).toBe(200);
    await expect(admin(['projects',project,'agents',old.agentId,'credentials'],{expires_days:null})).rejects.toMatchObject({code:'KEY_BOUND_AGENT'});
    await expect(transaction(c=>issueAgentKit(c,owner,project,old.agentId,{expires_days:null}))).rejects.toMatchObject({code:'KEY_BOUND_AGENT'});
  });
  it('exports null in fresh ZIP and third-party kits and retains prepared access duration',async()=>{
    const id=await agent();const kit=unzip((await transaction(c=>issueAgentKit(c,owner,project,id,{expires_days:null}))).archive);expect(kit.config.expiresAt).toBeNull();expect(kit.readme).toContain('Unlimited (until revoked)');
    const prompt=(await transaction(c=>issueAgentKit(c,owner,project,id,{format:'third-party',expires_days:null}))).archive.toString('utf8');expect(JSON.parse(prompt.split('```json\n')[1].split('```')[0]).expires_at).toBeNull();
    const preparedId=await agent();const prepared=await transaction(c=>prepareAgentAccess(c,owner.id,project,preparedId));
    const finite=unzip((await transaction(c=>issueAgentKit(c,owner,project,preparedId,{expires_days:null}))).archive);expect(finite.config.expiresAt).toBe(prepared.expires_at.toISOString());
    const unlimitedId=await agent();const pending=await transaction(c=>prepareAgentAccess(c,owner.id,project,unlimitedId));await db.query('UPDATE bridge_credentials SET expires_at=NULL WHERE id=$1',[pending.id]);
    expect((await snapshot()).credentials.find((k:any)=>k.id===pending.id).download_pending).toBe(true);
    const unlimited=unzip((await transaction(c=>issueAgentKit(c,owner,project,unlimitedId,{expires_days:1}))).archive);expect(unlimited.config.expiresAt).toBeNull();expect(unlimited.config.access.startsWith('oab_'+pending.id+'.')).toBe(true);
    expect((await snapshot()).credentials.find((k:any)=>k.id===pending.id).download_pending).toBe(false);
  });
  it('converts only non-revoked project access and retries idempotently without re-enabling disabled agents',async()=>{
    const id=await agent(),disabled=await agent(),foreign=await agent(otherProject);
    const finite:any=await admin(['projects',project,'agents',id,'credentials'],{expires_days:2});
    const revoked:any=await admin(['projects',project,'agents',id,'credentials'],{expires_days:3});await admin(['projects',project,'credentials',revoked.id,'revoke']);
    await admin(['projects',project,'agents',disabled,'credentials'],{expires_days:4});await admin(['projects',project,'agents',disabled,'state'],{active:false});
    const untouched:any=await admin(['projects',otherProject,'agents',foreign,'credentials'],{expires_days:5});
    await db.query("UPDATE bridge_credentials SET expires_at=now()-interval '1 day' WHERE id=$1",[finite.id]);
    const before=(await snapshot()).credentials.find((k:any)=>k.id===revoked.id).expires_at;const key=randomUUID();const result=await admin(['projects',project,'extend-validity'],{days:null},key);
    expect(await admin(['projects',project,'extend-validity'],{days:null},key)).toEqual(result);
    await expect(admin(['projects',project,'extend-validity'],{days:5},key)).rejects.toMatchObject({status:409});
    const after=await snapshot();expect(after.credentials.filter((k:any)=>!k.revoked_at).every((k:any)=>k.expires_at===null)).toBe(true);expect(after.credentials.find((k:any)=>k.id===revoked.id).expires_at).toEqual(before);expect(after.agents.find((a:any)=>a.id===disabled).active).toBe(false);
    expect(new Date((await snapshot(otherProject)).credentials.find((k:any)=>k.id===untouched.id).expires_at).toISOString()).toBe(untouched.expires_at.toISOString());
    await admin(['projects',project,'extend-validity'],{days:5},randomUUID());expect((await snapshot()).credentials.filter((k:any)=>!k.revoked_at).every((k:any)=>k.expires_at===null)).toBe(true);
    await expect(adminOperation(db,{id:randomUUID(),email:'other@example.test'},'POST',['projects',project,'extend-validity'],{days:null},{key:randomUUID()})).rejects.toThrow();
  });
  it('preserves revocation, disabled/archive/owner state checks, rate admission and legacy session replacement',async()=>{
    const id=await agent(),credential:any=await admin(['projects',project,'agents',id,'credentials'],{expires_days:null}),c:any={token:credential.token};
    const first=await call(c,'sessions',{});c.session=first.data.session_id;expect(first.status).toBe(200);const next=await call({token:c.token},'sessions',{});expect((await call(c,'peers')).status).toBe(409);c.session=next.data.session_id;
    await recordAttempt(db,c.token);expect((await db.query('SELECT count FROM bridge_rate_windows WHERE actor_id=$1',[id])).rows[0].count).toBeGreaterThan(0);
    await admin(['projects',project,'agents',id,'state'],{active:false});expect((await call(c,'bootstrap')).status).toBe(401);await admin(['projects',project,'agents',id,'state'],{active:true});
    await admin(['projects',project,'state'],{state:'archived'});expect((await call(c,'bootstrap')).status).toBe(401);await admin(['projects',project,'state'],{state:'active'});
    await db.query('UPDATE bridge_owner_state SET active=false WHERE owner_id=$1',[owner.id]);expect((await call(c,'bootstrap')).status).toBe(401);await db.query('UPDATE bridge_owner_state SET active=true WHERE owner_id=$1',[owner.id]);
    await admin(['projects',project,'credentials',credential.id,'revoke']);expect((await call(c,'bootstrap')).status).toBe(401);
  });
  it('rechecks revoked unlimited access before releasing a waiting inbox response',async()=>{
    const id=await agent(),credential:any=await admin(['projects',project,'agents',id,'credentials'],{expires_days:null}),c:any={token:credential.token};c.session=(await call(c,'sessions',{})).data.session_id;
    const pending=call(c,'inbox?wait_seconds=2');await new Promise(resolve=>setTimeout(resolve,100));await admin(['projects',project,'credentials',credential.id,'revoke']);expect((await pending).status).toBe(401);
  });
});
