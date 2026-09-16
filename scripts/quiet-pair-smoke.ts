import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {issueAgentKit} from '../src/lib/agent-kit';
import {ownerTransaction} from '../src/lib/admin-service';
import {adminOperation} from '../src/lib/admin-service';
import {handleAgentRequest} from '../src/lib/agent-api';
import {QuietSession} from './quiet-session.mjs';

const url=new URL(process.env.TEST_DATABASE_URL!);
if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test')throw Error('Isolated test DB only');
const db=new Pool({connectionString:url.toString()});
const owner={id:randomUUID(),email:`quiet-${randomUUID()}@example.test`};
const cwd=resolve('.local/quiet-prototype',randomUUID());await mkdir(cwd,{recursive:true});
await writeFile(resolve(cwd,'AGENTS.md'),'Synthetic text-only transport test. Do not use tools or access client files.\n');
let project:string|undefined,session:any,peerSession:any,peerPrevious:any;
const events:any[]=[];let stoppedPid:number|undefined;
const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
  try {
    const response=await handleAgentRequest(new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,...(req.method==='POST'?{body:Buffer.concat(chunks).toString()}: {})}),db);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch{res.writeHead(500);res.end('{}');}
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const waitFor=async(test:()=>boolean,seconds=150)=>{const start=Date.now();while(!test()){if(session?.fault)throw session.fault;if(Date.now()-start>seconds*1000)throw Error('Smoke wait timeout');await new Promise(r=>setTimeout(r,200));}};
try {
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[owner.id,'Quiet synthetic owner',owner.email]);
  await db.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)',[owner.id]);
  const admin=(path:string[],body:unknown)=>adminOperation(db,owner,'POST',path,body,{key:randomUUID()});
  project=(await admin(['projects'],{name:'Quiet session synthetic',client_label:'No client data'}) as any).id;
  const env=(await admin(['projects',project!,'environments'],{name:'Isolated smoke'}) as any).id;
  const agent=(await admin(['projects',project!,'agents'],{name:'Quiet test agent',role:'development',environment_id:env}) as any).id;
  const kit=await ownerTransaction(db,owner,c=>issueAgentKit(c,owner,project!,agent,{}));
  let offset=0;const files:Record<string,string>={};
  while(kit.archive.readUInt32LE(offset)===0x04034b50){const size=kit.archive.readUInt32LE(offset+18),length=kit.archive.readUInt16LE(offset+26);const name=kit.archive.subarray(offset+30,offset+30+length).toString();const start=offset+30+length;files[name]=kit.archive.subarray(start,start+size).toString();offset=start+size;}
  const config=JSON.parse(files['bridge.config.json']);const token=config.access;
  for(const [name,content] of Object.entries(files)){const target=resolve(cwd,name);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,content);}
  const operational=true;
  const peerEnv=(await admin(['projects',project!,'environments'],{name:'Deployment server'}) as any).id;
  const {QuietSession:KitSession}=await import(pathToFileURL(resolve(cwd,'scripts/quiet-session.mjs')).href);
  const peer=(await admin(['projects',project!,'agents'],{name:'Deployment peer',role:'deployment',environment_id:peerEnv}) as any).id;
  const peerToken=(await admin(['projects',project!,'agents',peer,'credentials'],{}) as any).token;
  const peerCwd=resolve(cwd,'peer');await mkdir(peerCwd,{recursive:true});
  await writeFile(resolve(peerCwd,'AGENTS.md'),'Synthetic bridge test. Use only bridge_request. Complete the requested arithmetic task through the task API. No file or shell access. Do not respond to routine result acknowledgements.');
  peerSession=new KitSession({executable:process.env.QUIET_CODEX_EXE,cwd:peerCwd,operational:true,yolo:true,origin,token:peerToken,statePath:resolve(cwd,'peer-state.json'),onEvent:(event:any)=>console.log(JSON.stringify({peer:true,...event}))});
  await peerSession.start();

  session=new KitSession({executable:process.env.QUIET_CODEX_EXE,cwd:resolve(cwd,'workspace'),operational,yolo:config.yolo,origin,token,statePath:resolve(cwd,'adapter-state.json'),onEvent:(event:any)=>{events.push(event);console.log(JSON.stringify(event));}});
  await session.start();stoppedPid=session.child.pid;
  await waitFor(()=>session.metrics.emptyWaits>=2 && !session.busy,150);
  const baseline=session.metrics.modelTurns;
  if(session.metrics.modelTurns!==(operational?1:0))throw Error('Idle invoked a model');
  console.log(JSON.stringify({check:'quiet-idle',emptyWaits:session.metrics.emptyWaits,modelTurns:session.metrics.modelTurns}));
  await waitFor(()=>!peerSession.busy,120);
  peerPrevious=peerSession;
  peerSession=new KitSession({executable:process.env.QUIET_CODEX_EXE,cwd:peerCwd,operational:true,yolo:true,origin,token:peerToken,statePath:resolve(cwd,'peer-state.json'),onEvent:(event:any)=>console.log(JSON.stringify({replacement:true,...event}))});
  await peerSession.start();
  await waitFor(()=>peerPrevious.stopping && peerPrevious.child.exitCode!==null,40);
  console.log(JSON.stringify({sameCredentialReplacement:true,oldProcessExited:true,manualPairing:false}));
  await admin(['projects',project!,'messages'],{recipient_agent_id:agent,body:'Synthetic autonomous coordination test. Use only bridge_request, no shell or file access. Discover your deployment peer, create a conversation and a task for that peer to calculate 17+25 and record completed evidence with the answer 42. Read the relevant guides for the API shapes. Send the task once. Do not do its work yourself. Do not reply to routine progress or completed acknowledgements. Report briefly.'});
  const start=Date.now();let completed=false;
  while(Date.now()-start<240000) {
    if(session.fault||peerSession.fault)throw session.fault??peerSession.fault;
    const tasks=(await db.query('SELECT state,result,assignee_id FROM bridge_tasks WHERE project_id=$1',[project])).rows;
    if(tasks.some(t=>t.state==='completed'&&t.assignee_id===peer&&JSON.stringify(t.result).includes('42'))){completed=true;break;}
    await new Promise(r=>setTimeout(r,500));
  }
  if(!completed)throw Error('Autonomous task did not complete');
  await waitFor(()=>!session.busy && !peerSession.busy,120);
  await peerSession.stop();
  await session.stop();
  if(operational && !session.metrics.toolCalls)throw Error('No authenticated model tool calls succeeded');
  if(session.child.exitCode===null&&session.child.signalCode===null)throw Error('Child still alive');
  const agentState=(await db.query('SELECT session_id FROM bridge_agents WHERE id=$1',[agent])).rows[0];
  if(agentState.session_id!==null)throw Error('Bridge session not closed');
  const result={passed:true,autonomousTaskCompleted:true,metrics:session.metrics,childPid:stoppedPid,childExited:true,sessionClosed:true,syntheticOnly:true};
  await writeFile(resolve(cwd,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
  if(peerPrevious)await peerPrevious.stop();
  if(peerSession)await peerSession.stop();
  if(session&&!session.stopping)await session.stop();
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  if(project)await adminOperation(db,owner,'POST',['projects',project,'delete'],{confirm_name:'Quiet session synthetic'});
  await db.query('DELETE FROM bridge_idempotency WHERE actor_id=$1',[owner.id]);
  await db.query('DELETE FROM bridge_audit WHERE owner_id=$1',[owner.id]);
  await db.query('DELETE FROM bridge_owner_state WHERE owner_id=$1',[owner.id]);
  await db.query('DELETE FROM "user" WHERE id=$1',[owner.id]);await db.end();
}
