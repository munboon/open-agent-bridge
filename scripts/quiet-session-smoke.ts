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
let project:string|undefined,session:any;
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
  const agent=(await admin(['projects',project!,'agents'],{name:'Quiet test agent',role:'deployment',environment_id:env}) as any).id;
  const kit=await ownerTransaction(db,owner,c=>issueAgentKit(c,owner,project!,agent,{}));
  let offset=0;const files:Record<string,string>={};
  while(kit.archive.readUInt32LE(offset)===0x04034b50){const size=kit.archive.readUInt32LE(offset+18),length=kit.archive.readUInt16LE(offset+26);const name=kit.archive.subarray(offset+30,offset+30+length).toString();const start=offset+30+length;files[name]=kit.archive.subarray(start,start+size).toString();offset=start+size;}
  const config=JSON.parse(files['bridge.config.json']);const token=config.access;
  for(const [name,content] of Object.entries(files)){const target=resolve(cwd,name);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,content);}
  const operational=process.env.QUIET_OPERATIONAL==='1';
  const {QuietSession:KitSession}=await import(pathToFileURL(resolve(cwd,'scripts/quiet-session.mjs')).href);
  session=new KitSession({executable:process.env.QUIET_CODEX_EXE,cwd:resolve(cwd,'workspace'),operational,yolo:config.yolo,origin,token,statePath:resolve(cwd,'adapter-state.json'),onEvent:(event:any)=>{events.push(event);console.log(JSON.stringify(event));}});
  await session.start();stoppedPid=session.child.pid;
  const idlePolls=Number(process.env.QUIET_IDLE_POLLS??2);
  const memoryStart=process.memoryUsage().rss;
  await waitFor(()=>session.metrics.emptyWaits>=idlePolls && !session.busy,idlePolls*25+150);
  console.log(JSON.stringify({idlePolls,adapterRssStart:memoryStart,adapterRssEnd:process.memoryUsage().rss,queue:session.queue.length,known:session.known.size}));
  const baseline=session.metrics.modelTurns;
  if(session.metrics.modelTurns!==(operational?1:0))throw Error('Idle invoked a model');
  console.log(JSON.stringify({check:'quiet-idle',emptyWaits:session.metrics.emptyWaits,modelTurns:session.metrics.modelTurns}));
  const sent=await admin(['projects',project!,'messages'],{recipient_agent_id:agent,body:operational?'Use bridge_request to read peers with body null and key null. Then reply exactly BRIDGE_RECEIVED. Do not use shell tools.':'Transport test: respond with exactly BRIDGE_RECEIVED.'}) as any;
  await waitFor(()=>session.metrics.modelTurns===baseline+1);
  session.chat('Local operator chat test: respond with exactly LOCAL_CHAT_RECEIVED.');
  await waitFor(()=>session.metrics.messagesHandled===1 && events.some(e=>e.type==='chat-reply'&&e.text.includes('LOCAL_CHAT_RECEIVED')));
  const rows=(await db.query('SELECT author_type,body,acknowledged_at FROM bridge_messages WHERE conversation_id=$1 ORDER BY sequence',[sent.conversation_id])).rows;
  if(rows.length!==2||!rows[0].acknowledged_at||!rows[1].body.includes('BRIDGE_RECEIVED'))throw Error('Bridge roundtrip failed');
  if(!events.some(e=>e.type==='chat-reply'&&e.text.includes('LOCAL_CHAT_RECEIVED')))throw Error('Local chat failed');
  await session.stop();
  if(operational && !session.metrics.toolCalls)throw Error('No authenticated model tool calls succeeded');
  if(session.child.exitCode===null&&session.child.signalCode===null)throw Error('Child still alive');
  const agentState=(await db.query('SELECT session_id FROM bridge_agents WHERE id=$1',[agent])).rows[0];
  if(agentState.session_id!==null)throw Error('Bridge session not closed');
  const result={passed:true,metrics:session.metrics,childPid:stoppedPid,childExited:true,sessionClosed:true,syntheticOnly:true};
  await writeFile(resolve(cwd,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
  if(session&&!session.stopping)await session.stop();
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  if(project)await adminOperation(db,owner,'POST',['projects',project,'delete'],{confirm_name:'Quiet session synthetic'});
  await db.query('DELETE FROM bridge_idempotency WHERE actor_id=$1',[owner.id]);
  await db.query('DELETE FROM bridge_audit WHERE owner_id=$1',[owner.id]);
  await db.query('DELETE FROM bridge_owner_state WHERE owner_id=$1',[owner.id]);
  await db.query('DELETE FROM "user" WHERE id=$1',[owner.id]);await db.end();
}
