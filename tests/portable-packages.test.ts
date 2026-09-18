import {attachMessageSockets} from '../scripts/websocket-transport.mjs';
import {GET as servedClient} from '../src/app/api/agent-client/route';
import {randomUUID,randomBytes,generateKeyPairSync,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {main as clientMain,storage} from '../scripts/bridge-client.mjs';
import {mkdtemp,readdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {adminOperation,ownerTransaction} from '../src/lib/admin-service';
import {issueEnrollment} from '../src/lib/agent-enrollment';
import {handleAgentRequest} from '../src/lib/agent-api';
import {signedHeaders} from '../scripts/bridge-client.mjs';
import {purgePackages} from '../scripts/package-retention';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
describe.skipIf(!process.env.TEST_DATABASE_URL)('portable enrollment and bridge packages',()=>{
 let db:Pool,root:string,project:string,a:any,b:any,foreign:any,convo:string;const owner={id:randomUUID(),email:randomUUID()+'@example.test'};
 const oldRoot=process.env.BRIDGE_PACKAGE_ROOT,oldEnvelope=process.env.BRIDGE_ENVELOPE_KEY;
 async function admin(path:string[],body:unknown){return adminOperation(db,owner,'POST',path,body);}
 async function call(config:any,path:string,body?:unknown,overrides:Record<string,string>={}){
  if(path==='sessions'&&config.device&&body&&!(body as any).challenge){const c=await call(config,'sessions/challenge',{});body={...(body as object),challenge:c.data.challenge};}
  const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),key=randomUUID();
  const headers={...signedHeaders(config,method,'/api/v1/'+path,raw,key),...overrides};
  const response=await handleAgentRequest(new Request('http://127.0.0.1/api/v1/'+path,{method,headers,body:body===undefined?undefined:raw}),db);return {status:response.status,data:await response.json()};
 }
 async function agent(name:string,projectId=project){
  const env=(await admin(['projects',projectId,'environments'],{name})) as any;
  const row=(await db.query('SELECT id FROM bridge_agents WHERE environment_id=$1',[env.id])).rows[0];
  const setup=await ownerTransaction(db,owner,c=>issueEnrollment(c,owner,projectId,row.id,{}));
  const token=/Enrollment code: (\S+)/.exec(setup.prompt)![1];const keys=generateKeyPairSync('ed25519');
  return {device:{os:'linux',machine:'a'.repeat(64),installation:randomUUID()},agentId:row.id,origin:'http://127.0.0.1',token,privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:keys.publicKey.export({format:'pem',type:'spki'})};
 }
 async function claim(config:any){expect((await call(config,'enrollments/claim',{public_key:config.publicKey})).status).toBe(200);const session=await call(config,'sessions',{});expect(session.status).toBe(200);config.session=session.data.session_id;}
 beforeAll(async()=>{
  const url=new URL(process.env.TEST_DATABASE_URL!);if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test')throw Error('Only isolated test database allowed.');db=new Pool({connectionString:url.toString()});
  root=await mkdtemp(join(tmpdir(),'bridge-packages-'));process.env.BRIDGE_PACKAGE_ROOT=root;process.env.BRIDGE_ENVELOPE_KEY=randomBytes(32).toString('base64');
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[owner.id,'Synthetic owner',owner.email]);await db.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)',[owner.id]);
  project=(await admin(['projects'],{name:'Portable package tests',client_label:'Synthetic'} ) as any).id;
  a=await agent('Sender');b=await agent('Recipient');const other=(await admin(['projects'],{name:'Other project',client_label:'Synthetic'}) as any).id;foreign=await agent('Foreign',other);
 });
 afterAll(async()=>{
  if(db){const projects=(await db.query('SELECT id FROM bridge_projects WHERE owner_id=$1',[owner.id])).rows;for(const row of projects)await admin(['projects',row.id,'delete'],{confirm_name:(await db.query('SELECT name FROM bridge_projects WHERE id=$1',[row.id])).rows[0].name});await db.query('DELETE FROM bridge_audit WHERE owner_id=$1',[owner.id]);await db.query('DELETE FROM bridge_owner_state WHERE owner_id=$1',[owner.id]);await db.query('DELETE FROM "user" WHERE id=$1',[owner.id]);await db.end();}
  if(root)await rm(root,{recursive:true,force:true});if(oldRoot===undefined)delete process.env.BRIDGE_PACKAGE_ROOT;else process.env.BRIDGE_PACKAGE_ROOT=oldRoot;if(oldEnvelope===undefined)delete process.env.BRIDGE_ENVELOPE_KEY;else process.env.BRIDGE_ENVELOPE_KEY=oldEnvelope;
 });
 it('allows only self-registration and rejects silent encryption key replacement',async()=>{
  const agentConfig=await agent('Encryption identity');await claim(agentConfig);
  const privateKey=execFileSync(process.env.AGE_KEYGEN_BINARY??'age-keygen',[],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
  const public_key=execFileSync(process.env.AGE_KEYGEN_BINARY??'age-keygen',['-y'],{input:privateKey,encoding:'utf8'}).trim();
  const payload={scheme:'age',public_key};
  const first=await call(agentConfig,'recipient-key',payload);expect(first.status).toBe(200);
  expect((await call(agentConfig,'recipient-key',payload)).data).toEqual(first.data);
  expect((await call(agentConfig,'recipient-key',{...payload,agent_id:a.agentId})).status).toBe(422);
  expect((await call(agentConfig,'recipient-key',{...payload,public_key:'age1'+'q'.repeat(58)})).status).toBe(409);
  expect((await call({...agentConfig,session:randomUUID()},'recipient-key',payload)).status).toBe(409);
 });
 it('pins generated setup to the exact client served for download',async()=>{
  const env:any=await admin(['projects',project,'environments'],{name:'Client hash check'});
  const row=(await db.query('SELECT id FROM bridge_agents WHERE environment_id=$1',[env.id])).rows[0];
  const setup=await ownerTransaction(db,owner,c=>issueEnrollment(c,owner,project,row.id,{}));
  const expected=/SHA-256 equals ([0-9a-f]{64})/.exec(setup.prompt)![1];
  const response=await servedClient();expect(sha(Buffer.from(await response.arrayBuffer()))).toBe(expected);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
 });
 it('shares editable role descriptions with permitted peers without private instructions',async()=>{
  const sender=await agent('Role observer'),support=await agent('Support specialist');await claim(sender);await claim(support);
  const path=['projects',project,'agents',support.agentId,'instructions'];
  const initial:any=await adminOperation(db,owner,'GET',path,null);
  const description='Handle escalated billing issues and coordinate fixes.';
  await admin(path,{prompt_template:'support_l2',description,work_instructions:'PRIVATE operational instructions',expected_revision:initial.revision});
  const peers=(await call(sender,'peers')).data.peers;
  const discovered=peers.find((peer:any)=>peer.id===support.agentId);
  expect(discovered).toMatchObject({prompt_template:'support_l2',role_name:'Support L2',description});
  expect(JSON.stringify(peers)).not.toContain('PRIVATE operational instructions');
  expect((await adminOperation(db,owner,'GET',path,null) as any).description).toBe(description);
  await expect(admin(path,{prompt_template:'support_l2',description:'x'.repeat(1001),work_instructions:null,expected_revision:initial.revision+1})).rejects.toThrow();
  await admin(['projects',project,'pairings'],{agent_a:sender.agentId,agent_b:support.agentId,enabled:false});
  expect((await call(sender,'peers')).data.peers.some((peer:any)=>peer.id===support.agentId)).toBe(false);
 });
 it('reports one-time setup lifecycle without exposing credentials or crossing projects',async()=>{
  const identity=await agent('Setup lifecycle');const cid=identity.token.slice(4).split('.')[0];const path=['projects',project,'agents',identity.agentId,'enrollments',cid];
  const read=()=>adminOperation(db,owner,'GET',path,null);
  const pending:any=await read();expect(pending.status).toBe('pending');expect(Object.keys(pending).sort()).toEqual(['expires_at','registered_at','status']);
  await expect(adminOperation(db,owner,'GET',['projects',project,'agents',foreign.agentId,'enrollments',cid],null)).rejects.toThrow();
  await expect(adminOperation(db,{id:randomUUID(),email:'other@example.test'},'GET',path,null)).rejects.toThrow();
  await claim(identity);expect(await read()).toMatchObject({status:'claimed'});
  const unused=await agent('Unused setup');const unusedId=unused.token.slice(4).split('.')[0],unusedPath=['projects',project,'agents',unused.agentId,'enrollments',unusedId];
  await db.query("UPDATE bridge_credentials SET enrollment_expires_at=now()-interval '1 second' WHERE id=$1",[unusedId]);expect(await adminOperation(db,owner,'GET',unusedPath,null)).toMatchObject({status:'expired'});
  await ownerTransaction(db,owner,c=>issueEnrollment(c,owner,project,unused.agentId,{}));expect(await adminOperation(db,owner,'GET',unusedPath,null)).toMatchObject({status:'revoked'});
 });
 it('claims once, requires key proofs, and keeps the registered session',async()=>{
  expect((await call(a,'bootstrap')).status).toBe(401);await claim(a);await claim(b);await claim(foreign);
  const copied={...a,...(()=>{const k=generateKeyPairSync('ed25519');return {privateKey:k.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:k.publicKey.export({format:'pem',type:'spki'})};})()};
  expect((await call(copied,'enrollments/claim',{public_key:copied.publicKey})).status).toBe(401);
  expect((await call(copied,'bootstrap')).status).toBe(401);
  expect((await call(a,'bootstrap',undefined,{'X-Bridge-Proof':''})).status).toBe(401);
  expect((await call({...a,session:undefined},'sessions',{})).status).toBe(409);
  expect((await call(a,'sessions',{})).data.session_id).toBe(a.session);
  expect((await call(a,'bootstrap')).status).toBe(200);
  await expect(ownerTransaction(db,owner,c=>issueEnrollment(c,owner,project,a.agentId,{}))).rejects.toMatchObject({code:'ALREADY_ENROLLED'});
  convo=(await call(a,'conversations',{recipient_agent_id:b.agentId})).data.id;expect(convo).toBeTruthy();
 });
 it('rejects copied credentials with missing or changed device binding',async()=>{
  const c:any=await agent('Device binding');await claim(c);
  expect((await call({...c,device:undefined},'bootstrap')).status).toBe(403);
  expect((await call({...c,device:{...c.device,machine:'b'.repeat(64)}},'bootstrap')).status).toBe(403);
  expect((await call({...c,device:{...c.device,installation:randomUUID()}},'bootstrap')).status).toBe(403);
  const challenge=(await call(c,'sessions/challenge',{})).data.challenge;
  expect((await call(c,'sessions',{challenge})).status).toBe(200);
  expect((await call(c,'sessions',{challenge})).status).toBe(401);
  expect((await call(c,'sessions/current/close',{})).status).toBe(200);
  const previous=c.session;delete c.session;
  const fresh=await call(c,'sessions',{});expect(fresh.status).toBe(200);expect(fresh.data.session_id).not.toBe(previous);
  expect((await call({...c,session:previous},'bootstrap')).status).toBe(200); // Bootstrap discovers identity without authorizing an inbox session.
  expect((await call({...c,session:previous},'inbox?wait_seconds=0')).status).toBe(409);
 });
 it('reports polling schedules only explicitly and does not reset them on unrelated contact',async()=>{
  const c=await agent('Contact schedule');await claim(c);
  const state=async()=>(await db.query('SELECT contact_state FROM bridge_agents WHERE id=$1',[c.agentId])).rows[0].contact_state;
  await call(c,'inbox?wait_seconds=0');expect(await state()).toBeNull();
  expect((await call(c,'connection-mode',{mode:'short_poll',interval_seconds:0})).status).toBe(422);
  expect((await call(c,'connection-mode',{mode:'short_poll',interval_seconds:5})).status).toBe(200);
  const snapshot:any=await adminOperation(db,owner,'GET',['projects',project],null);
  expect(snapshot.agents.find((a:any)=>a.id===c.agentId).status.contact).toMatchObject({mode:'short_poll',interval_seconds:5});
  const declared=await state();await call(c,'bootstrap');expect((await state()).next_at).toBe(declared.next_at);
  await call(c,'inbox?wait_seconds=0');expect(Date.parse((await state()).next_at)).toBeGreaterThanOrEqual(Date.parse(declared.next_at));
  expect((await call(c,'connection-mode',{mode:'checkpoint'})).status).toBe(200);expect((await state()).next_at).toBeNull();
  await call(c,'sessions/current/close',{});expect(await state()).toMatchObject({mode:'checkpoint',next_at:null,listening_until:null});
 });
 it('rejects replay, altered payload and altered path',async()=>{
  const headers=signedHeaders(a,'GET','/api/v1/peers','');
  expect((await handleAgentRequest(new Request(a.origin+'/api/v1/peers',{headers}),db)).status).toBe(200);
  expect((await handleAgentRequest(new Request(a.origin+'/api/v1/peers',{headers}),db)).status).toBe(401);
  const altered=signedHeaders(a,'POST','/api/v1/acknowledgements',JSON.stringify({message_ids:[randomUUID()]}));
  expect((await handleAgentRequest(new Request(a.origin+'/api/v1/acknowledgements',{method:'POST',headers:altered,body:JSON.stringify({message_ids:[randomUUID()]})}),db)).status).toBe(401);
  const otherPath=signedHeaders(a,'GET','/api/v1/peers','');expect((await handleAgentRequest(new Request(a.origin+'/api/v1/tasks',{headers:otherPath}),db)).status).toBe(401);
 });
 it('transfers both directions and removes bytes only after recipient verification',async()=>{
  for(const [sender,recipient] of [[a,b],[b,a]]){
   const bytes=Buffer.from('Synthetic parcel '+randomUUID()),hash=sha(bytes);
   const created=await call(sender,'packages',{conversation_id:convo,filename:'parcel.zip',size:bytes.length,sha256:hash,sensitivity:'synthetic'});expect(created.status).toBe(200);const id=created.data.id;
   expect((await call(recipient,`packages/${id}/parts/0`)).status).toBe(410);
   expect((await call(sender,`packages/${id}/complete`,{})).status).toBe(409);
   const part={data:bytes.toString('base64'),sha256:hash};expect((await call(recipient,`packages/${id}/parts/0`,part)).status).toBe(404);
   expect((await call(sender,`packages/${id}/parts/0`,part)).status).toBe(200);expect((await call(sender,`packages/${id}/parts/0`,part)).status).toBe(200);
   expect((await call(sender,`packages/${id}/complete`,{})).status).toBe(200);
   expect((await call(foreign,`packages/${id}`)).status).toBe(404);expect((await call(sender,`packages/${id}/parts/0`)).status).toBe(404);
   expect(Buffer.from((await call(recipient,`packages/${id}/parts/0`)).data.data,'base64')).toEqual(bytes);
   expect((await call(recipient,`packages/${id}/receipt`,{size:bytes.length,sha256:'0'.repeat(64)})).status).toBe(422);
   expect((await readdir(root)).some(n=>n.startsWith(id))).toBe(true);
   expect((await call(recipient,`packages/${id}/receipt`,{size:bytes.length,sha256:hash})).status).toBe(200);
   expect((await call(recipient,`packages/${id}/receipt`,{size:bytes.length,sha256:hash})).status).toBe(200);
   expect((await readdir(root)).some(n=>n.startsWith(id))).toBe(false);
   expect((await call(recipient,`packages/${id}/parts/0`)).status).toBe(410);
   expect((await call(sender,`packages/${id}`)).data.state).toBe('verified');
  }
 });
 it('enforces pairing, sensitive encryption, size limits and expiry cleanup',async()=>{
  const bytes=Buffer.from('abc'),payload={conversation_id:convo,filename:'safe.bin',size:3,sha256:sha(bytes),sensitivity:'synthetic'};
  expect((await call(a,'packages',{...payload,sensitivity:'sensitive'})).status).toBe(422);
  expect((await call(a,'packages',{...payload,filename:'../escape'})).status).toBe(422);
  expect((await call(a,'packages',{...payload,size:1073741825})).status).toBe(422);
  const id=(await call(a,'packages',payload)).data.id;
  await call(a,`packages/${id}/parts/0`,{data:bytes.toString('base64'),sha256:sha(bytes)});await call(a,`packages/${id}/complete`,{});
  await admin(['projects',project,'pairings'],{agent_a:a.agentId,agent_b:b.agentId,enabled:false});expect((await call(b,`packages/${id}/parts/0`)).status).toBe(404);
  await admin(['projects',project,'pairings'],{agent_a:a.agentId,agent_b:b.agentId,enabled:true});
  await db.query("UPDATE bridge_packages SET expires_at=now()-interval '1 second' WHERE id=$1",[id]);expect((await call(b,`packages/${id}/parts/0`)).status).toBe(410);
  await purgePackages(db);expect((await readdir(root)).some(n=>n.startsWith(id))).toBe(false);
 });
 it('caps storage reservations, frees cancelled reservations and rejects expired setup',async()=>{
  const payload={conversation_id:convo,filename:'reserved.bin',size:1073741824,sha256:'a'.repeat(64),sensitivity:'synthetic'};
  expect((await call(a,'packages',{...payload,size:1073741825})).status).toBe(422);
  const first=await call(a,'packages',payload),second=await call(a,'packages',payload);expect(first.status).toBe(200);expect(second.status).toBe(200);
  const lastPart=Buffer.alloc(262144,7);
  expect((await call(a,`packages/${first.data.id}/parts/4095`,{data:lastPart.toString('base64'),sha256:sha(lastPart)})).status).toBe(200);
  expect((await call(a,`packages/${first.data.id}/parts/4096`,{data:lastPart.toString('base64'),sha256:sha(lastPart)})).status).toBe(422);
  expect((await call(a,'packages',{...payload,size:1})).status).toBe(409);
  expect((await call(a,`packages/${first.data.id}/cancel`,{})).status).toBe(200);expect((await call(a,`packages/${second.data.id}/cancel`,{})).status).toBe(200);
  const expired=await agent('Expired setup');await db.query("UPDATE bridge_credentials SET enrollment_expires_at=now()-interval '1 second' WHERE id=$1",[expired.token.slice(4).split('.')[0]]);
  expect((await call(expired,'enrollments/claim',{public_key:expired.publicKey})).status).toBe(410);
  expect((await call(a,'bootstrap',undefined,{'X-Bridge-Time':'1000000000000'})).status).toBe(401);
 });
 it('advertises SSE and fences a stream when its session is replaced',async()=>{
  const config=await agent('Stream fencing');await claim(config);
  expect((await call(config,'bootstrap')).data.capabilities.message_transports).toEqual(['sse','long_poll','short_poll']);
  const response=await handleAgentRequest(new Request('http://127.0.0.1/api/v1/events',{headers:signedHeaders(config,'GET','/api/v1/events')}),db);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('connected');
  await db.query('UPDATE bridge_agents SET session_id=$2 WHERE id=$1',[config.agentId,randomUUID()]);
  let text='';while(true){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);}
  expect(text).toContain('event: reconnect');expect(text).not.toContain('event: messages');
 });
 it('closes an undrained SSE stream and releases its listener slot',async()=>{
  const config=await agent('Slow stream consumer');await claim(config);
  const open=()=>handleAgentRequest(new Request('http://127.0.0.1/api/v1/events',{headers:signedHeaders(config,'GET','/api/v1/events')}),db);
  const first=await open();expect(first.status).toBe(200);
  try {
   // Leave the first response unread so its bounded event queue fills.
   await new Promise(resolve=>setTimeout(resolve,2200));
   const next=await open();
   try {expect(next.status).toBe(200);} finally {await next.body?.cancel();}
  } finally {await first.body?.cancel();}
 });
 it.each(['websocket','sse','poll','short'])('runs the portable client with %s and verifies a multi-part parcel',async(mode)=>{
  const sender=await agent('Portable sender '+mode),recipient=await agent('Portable receiver '+mode);const local=await mkdtemp(join(tmpdir(),'bridge-client-test-'));const privateRoots:string[]=[];
  const server=createServer(async(req,res)=>{try{const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));const result=await handleAgentRequest(new Request(`http://127.0.0.1:${(server.address() as any).port}${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,body:req.method==='POST'?Buffer.concat(parts):undefined}),db);res.writeHead(result.status,Object.fromEntries(result.headers));if(result.headers.get('content-type')?.includes('text/event-stream')){const reader=result.body!.getReader();res.on('close',()=>void reader.cancel());while(true){const part=await reader.read();if(part.done)break;res.write(Buffer.from(part.value));}res.end();}else res.end(Buffer.from(await result.arrayBuffer()));}catch{res.writeHead(500);res.end('{}');}});
  const sockets=attachMessageSockets(server,(request:Request)=>handleAgentRequest(request,db,'websocket'));
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as any).port}`;let listener:ReturnType<typeof spawn>|undefined;
  try{
   const configs=[];
   for(const [index,identity] of [sender,recipient].entries()){
    const input=join(local,`enroll-${index}.json`),config=join(local,`config-${index}.json`);await writeFile(input,JSON.stringify({origin,agentId:identity.agentId,token:identity.token}),{mode:0o600});await writeFile(config,JSON.stringify({origin,agentId:identity.agentId}));
    privateRoots.push(await storage({origin,agentId:identity.agentId}));expect((await clientMain(['enroll',input])).registered).toBe(true);const connected=await clientMain(['connect',config]);expect(connected.connected).toBe(true);expect(connected.encryption.registered).toBe(true);configs.push(config);
   }
   const body=join(local,'conversation.json');await writeFile(body,JSON.stringify({recipient_agent_id:recipient.agentId}));const conversation=await clientMain(['request',configs[0],'POST','conversations',body,randomUUID()]);
   const first=await clientMain(['encryption-setup',configs[1]]);
   expect(first.registered).toBe(true);expect(await clientMain(['encryption-setup',configs[1]])).toEqual(first);
   expect(Object.keys(first).sort()).toEqual(['fingerprint','registered']);

   const bytes=randomBytes(300000),source=join(local,'parcel.bin'),output=join(local,'received.bin');await writeFile(source,bytes);const uploaded=await clientMain(['upload',configs[0],conversation.id,source,'synthetic']);
   listener=spawn(process.execPath,['scripts/bridge-client.mjs','listen',configs[1],mode],{stdio:['ignore','pipe','pipe']});
   await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Listener did not receive parcel notification')),5000);listener!.stdout!.on('data',chunk=>{if(String(chunk).includes('Bridge message stored:')){clearTimeout(timeout);resolve();}});listener!.once('exit',()=>{clearTimeout(timeout);reject(Error('Listener exited early'));});});
   const observed=(await db.query('SELECT contact_state FROM bridge_agents WHERE id=$1',[recipient.agentId])).rows[0].contact_state;
   expect(observed.mode).toBe(mode==='poll'?'long_poll':mode==='short'?'short_poll':mode);
   const inbox=await clientMain(['inbox',configs[1]]);expect(inbox.some((m:any)=>m.type==='package_ready')).toBe(true);
   const notification=inbox.find((m:any)=>m.type==='package_ready');expect((await clientMain(['inbox',configs[1],notification.id])).id).toBe(notification.id);
   const reply=await clientMain(['reply',configs[1],notification.id,'Received the package notice.']);expect(reply.acknowledged).toBe(true);expect(await clientMain(['reply',configs[1],notification.id,'Received the package notice.'])).toEqual(reply);
   const result=await clientMain(['download',configs[1],uploaded.package_id,output]);expect(result.verified).toBe(true);expect(await readFile(output)).toEqual(bytes);expect((await readdir(root)).some(n=>n.startsWith(uploaded.package_id))).toBe(false);
   const encrypted=await clientMain(['upload',configs[0],conversation.id,source,'sensitive','encrypted-test']);
   expect((await clientMain(['upload',configs[0],conversation.id,source,'sensitive','encrypted-test'])).package_id).toBe(encrypted.package_id);
   const metadata=await clientMain(['request',configs[1],'GET','packages/'+encrypted.package_id]);expect(metadata.encryption.scheme).toBe('age');expect(metadata.sha256).not.toBe(sha(bytes));
   const part=await clientMain(['request',configs[1],'GET',`packages/${encrypted.package_id}/parts/0`]);expect(Buffer.from(part.data,'base64').subarray(0,20).toString()).toContain('age-encryption.org');
   const keyPath=join(privateRoots[1],'recipient-key.json'),original=await readFile(keyPath);
   const wrong=JSON.parse((await readFile(join(privateRoots[0],'recipient-key.json'))).toString());await writeFile(keyPath,JSON.stringify(wrong),{mode:0o600});
   await expect(clientMain(['download',configs[1],encrypted.package_id,join(local,'decrypted.bin')])).rejects.toThrow();
   expect((await clientMain(['request',configs[1],'GET','packages/'+encrypted.package_id])).state).toBe('ready');
   await writeFile(keyPath,original,{mode:0o600});
   expect((await clientMain(['download',configs[1],encrypted.package_id,join(local,'decrypted.bin')])).verified).toBe(true);
   expect(await readFile(join(local,'decrypted.bin'))).toEqual(bytes);
   expect((await readdir(root)).some(n=>n.startsWith(encrypted.package_id))).toBe(false);
   const ended=once(listener,'exit');const stopAt=Date.now();listener.kill('SIGTERM');await ended;listener=undefined;expect(Date.now()-stopAt).toBeLessThan(3000);
   expect(JSON.parse(await readFile(join(privateRoots[1],'identity.json'),'utf8')).session).toBeUndefined();
   // Config files contain no reusable access or private key.
   expect(Object.keys(JSON.parse(await readFile(configs[0],'utf8'))).sort()).toEqual(['agentId','origin']);
  }finally{if(listener){listener.kill('SIGKILL');await once(listener,'exit').catch(()=>{});}for(const socket of sockets.clients)socket.terminate();sockets.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));for(const dir of privateRoots)await rm(dir,{recursive:true,force:true});await rm(local,{recursive:true,force:true});}
 },20000);
 it('owner replacement revokes the original key only when claimed',async()=>{
  const setup=await ownerTransaction(db,owner,c=>issueEnrollment(c,owner,project,a.agentId,{replace:true}));
  expect((await call(a,'bootstrap')).status).toBe(200);
  const keys=generateKeyPairSync('ed25519');const replacement={...a,session:undefined,token:/Enrollment code: (\S+)/.exec(setup.prompt)![1],privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:keys.publicKey.export({format:'pem',type:'spki'})};await claim(replacement);
  expect((await call(a,'bootstrap')).status).toBe(401);expect((await call(replacement,'bootstrap')).status).toBe(200);
  await admin(['projects',project,'agents',replacement.agentId,'revoke-access'],{confirm:true});expect((await call(replacement,'bootstrap')).status).toBe(401);
 });
});
