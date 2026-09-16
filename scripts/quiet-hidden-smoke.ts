import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {issueAgentKit} from '../src/lib/agent-kit';
import {ownerTransaction} from '../src/lib/admin-service';
import {adminOperation} from '../src/lib/admin-service';
import {handleAgentRequest} from '../src/lib/agent-api';

const url=new URL(process.env.TEST_DATABASE_URL!);
if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test')throw Error('Isolated test DB only');
const db=new Pool({connectionString:url.toString()});
const owner={id:randomUUID(),email:`quiet-${randomUUID()}@example.test`};
const cwd=resolve('.local/quiet-prototype',randomUUID());await mkdir(cwd,{recursive:true});
await writeFile(resolve(cwd,'AGENTS.md'),'Synthetic text-only transport test. Do not use tools or access client files.\n');
let project:string|undefined,hidden:any;
const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
  try {
    const response=await handleAgentRequest(new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,...(req.method==='POST'?{body:Buffer.concat(chunks).toString()}: {})}),db);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch{res.writeHead(500);res.end('{}');}
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
try {
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[owner.id,'Quiet synthetic owner',owner.email]);
  await db.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)',[owner.id]);
  const admin=(path:string[],body:unknown)=>adminOperation(db,owner,'POST',path,body,{key:randomUUID()});
  project=(await admin(['projects'],{name:'Quiet session synthetic',client_label:'No client data'}) as any).id;
  const env=(await admin(['projects',project!,'environments'],{name:'Isolated smoke'}) as any).id;
  const agent=(await admin(['projects',project!,'agents'],{name:'Quiet test agent',role:'deployment',environment_id:env}) as any).id;
  const kit=await ownerTransaction(db,owner,c=>issueAgentKit(c,owner,project!,agent,{}));
  let offset=0;const files:Record<string,string>={};
  while(kit.archive.readUInt32LE(offset)===0x04034b50){const size=kit.archive.readUInt32LE(offset+18),length=kit.archive.readUInt16LE(offset+26);const name=kit.archive.subarray(offset+30,offset+30+length).toString();const start=offset+30+length;files[name]=kit.archive.subarray(start,start+size).toString();offset=start+size;}
  const config=JSON.parse(files['bridge.config.json']);const token=config.access;
  for(const [name,content] of Object.entries(files)){const target=resolve(cwd,name);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,content);}
  config.origin=origin;config.executable=process.env.QUIET_CODEX_EXE;
  await writeFile(resolve(cwd,'bridge.config.json'),JSON.stringify(config));
  hidden=spawn('powershell.exe',['-NoProfile','-File',resolve(cwd,'Start-Agent.ps1'),'-WindowMode','Hidden','-InWindow'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
  hidden.stdout.resume();hidden.stderr.resume();
  const wait=async(check:()=>Promise<boolean>,seconds=150)=>{const deadline=Date.now()+seconds*1000;while(!await check()){if(hidden.exitCode!==null)throw Error('Hidden launcher exited early');if(Date.now()>deadline)throw Error('Hidden smoke timeout');await new Promise(r=>setTimeout(r,300));}};
  const controlPath=resolve(cwd,'state/control.json');
  await wait(async()=>{try{return JSON.parse(await readFile(controlPath,'utf8')).status==='running';}catch{return false;}});
  const sent=await admin(['projects',project!,'messages'],{recipient_agent_id:agent,body:'State whether this message is from a human portal operator or an AI peer. Reply exactly HUMAN_PORTAL_RECEIVED if it is a human portal operator. Do not use shell tools or access files.'}) as any;
  await wait(async()=>{const rows=(await db.query('SELECT body FROM bridge_messages WHERE conversation_id=$1 AND author_type=\'agent\'',[sent.conversation_id])).rows;return rows.some(r=>r.body.includes('HUMAN_PORTAL_RECEIVED'));});
  const stopper=spawn('powershell.exe',['-NoProfile','-File',resolve(cwd,'Stop-Agent.ps1')],{windowsHide:true,stdio:'ignore'});
  await new Promise<void>((res,rej)=>{stopper.once('exit',code=>code===0?res():rej(Error('Stop script failed')));stopper.once('error',rej);});
  await wait(async()=>JSON.parse(await readFile(controlPath,'utf8')).status==='stopped',20);
  await new Promise<void>((res,rej)=>{if(hidden.exitCode!==null){res();return;}const timer=setTimeout(()=>rej(Error('Hidden process did not exit')),15000);hidden.once('exit',()=>{clearTimeout(timer);res();});});
  const agentState=(await db.query('SELECT session_id FROM bridge_agents WHERE id=$1',[agent])).rows[0];
  if(agentState.session_id!==null)throw Error('Hidden bridge session not closed');
  console.log(JSON.stringify({passed:true,hidden:true,stdinClosed:true,humanSenderRecognized:true,cleanStop:true,syntheticOnly:true}));
} finally {
  if(hidden&&hidden.exitCode===null){try {const control=JSON.parse(await readFile(resolve(cwd,'state/control.json'),'utf8'));await writeFile(resolve(cwd,'state/stop.json'),JSON.stringify({runId:control.runId}));await new Promise(r=>setTimeout(r,4000));}catch{} if(hidden.exitCode===null)hidden.kill();}
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  if(project)await adminOperation(db,owner,'POST',['projects',project,'delete'],{confirm_name:'Quiet session synthetic'});
  await db.query('DELETE FROM bridge_idempotency WHERE actor_id=$1',[owner.id]);
  await db.query('DELETE FROM bridge_audit WHERE owner_id=$1',[owner.id]);
  await db.query('DELETE FROM bridge_owner_state WHERE owner_id=$1',[owner.id]);
  await db.query('DELETE FROM "user" WHERE id=$1',[owner.id]);await db.end();
}
