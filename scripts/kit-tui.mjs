// A session-local terminal connection. It never registers another bridge identity.
import { createRequire } from 'node:module';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
const require=createRequire(import.meta.url);
let ws;
try {ws=require('./ws.cjs');} catch(error) {if(error.code!=='MODULE_NOT_FOUND')throw error;ws=require('next/dist/compiled/ws');}

export class KitTerminal {
  constructor(session) {this.session=session;this.token=randomBytes(32).toString('base64url');this.serverRequests=new Map();}
  async start() {
    this.server=new ws.WebSocketServer({host:'127.0.0.1',port:0,maxPayload:16*1024*1024,verifyClient:({req})=>{
      const supplied=Buffer.from(req.headers.authorization??'');const expected=Buffer.from('Bearer '+this.token);
      return !req.headers.origin&&supplied.length===expected.length&&timingSafeEqual(supplied,expected);
    }});
    await new Promise((resolve,reject)=>{this.server.once('listening',resolve);this.server.once('error',reject);});
    this.server.on('connection',socket=>{
      if(this.client){socket.close(1008,'One terminal per kit');return;}
      this.client=socket;
      socket.on('message',data=>{let event;try{event=JSON.parse(data.toString());}catch{socket.close(1007,'Invalid message');return;}void this.receive(event);});
      socket.on('close',()=>{this.client=null;});
    });
    this.url='ws://127.0.0.1:'+this.server.address().port;
    return this;
  }
  send(event) {if(this.client?.readyState===ws.OPEN)this.client.send(JSON.stringify(event));}
  notification(event) {this.send(event);}
  serverRequest(event) {
    if(!this.client)return false;
    const id='open-agent-bridge-server-'+event.id;this.serverRequests.set(id,event.id);this.send({...event,id});return true;
  }
  async receive(event) {
    const s=this.session;
    if(!event.method) {
      if(this.serverRequests.has(event.id)) {const id=this.serverRequests.get(event.id);this.serverRequests.delete(event.id);s.child.stdin.write(JSON.stringify({...event,id})+'\n');}
      return;
    }
    if(event.method==='initialized')return;
    if(event.id===undefined)return;
    try {
      if(event.method==='initialize'){this.send({id:event.id,result:s.initializeResult});return;}
      if(s.stopping||s.fault)throw Error('The bridge session has stopped. Restart the kit.');
      const params=event.params??{};
      if(params.threadId&&params.threadId!==s.thread)throw Error('This kit terminal belongs to one agent conversation. Start a separate kit for another agent.');
      if(['thread/start','thread/fork','thread/archive','thread/unarchive'].includes(event.method))throw Error('Keep this kit conversation open. Use a separate Codex terminal for other conversations.');
      if(event.method==='thread/resume') {
        // The adapter already owns this running thread. Resuming it again can lose
        // tool ownership and fails before the first turn creates a rollout.
        const snapshot=await s.rpc('thread/read',{threadId:s.thread,includeTurns:false}).catch(()=>null);
        this.send({id:event.id,result:{...s.threadResult,thread:snapshot?.thread??s.threadResult.thread}});return;
      }
      if(event.method==='thread/turns/list') {
        let result;
        try {result=await s.rpc(event.method,params);}
        catch(error) {
          if(!/no rollout found|not materialized/i.test(error.message))throw error;
          this.emptyHistory=true;result={data:[],nextCursor:null,backwardsCursor:null};
        }
        this.send({id:event.id,result});return;
      }
      if(event.method==='thread/items/list'&&this.emptyHistory){this.send({id:event.id,result:{data:[],nextCursor:null,backwardsCursor:null}});return;}
      if(event.method==='thread/unsubscribe'){this.send({id:event.id,result:{}});return;}
      const bridgeInput=['turn/start','turn/steer'].includes(event.method)&&s.busy;
      if(bridgeInput&&s.state?.job) {
        // Native Codex steers its visible active turn. Record the intervention
        // before forwarding it so a local reply cannot become a portal reply.
        s.state.job.localIntervention=true;await s.save();
      }
      const localStart=event.method==='turn/start'&&!bridgeInput;
      if(localStart) {
        if(s.externalTurn||s.externalStarting)throw Error('A local turn is already running.');
        this.emptyHistory=false;s.externalStarting=true;s.externalTurn='pending';
      }
      let result;
      try {result=await s.rpc(event.method,event.method==='thread/resume'?{...params,...s.threadOptions,threadId:s.thread}:params);}
      finally {if(localStart){s.externalStarting=false;if(s.externalTurn==='pending')s.externalTurn=result?.turn?.id??null;}}
      this.send({id:event.id,result});
      void s.drain();
    } catch(error) {this.send({id:event.id,error:{code:-32000,message:error.message}});}
  }
  launch() {
    const s=this.session;
    this.child=spawn(s.executable,['--remote',this.url,'--remote-auth-token-env','OPEN_AGENT_BRIDGE_TERMINAL_TOKEN','--no-alt-screen','resume',s.thread],{cwd:s.cwd,env:{...process.env,OPEN_AGENT_BRIDGE_TERMINAL_TOKEN:this.token},stdio:'inherit',windowsHide:false});
    return new Promise((resolve,reject)=>{this.child.once('error',()=>reject(Error('Unable to open the Codex terminal. Check Codex CLI remote-terminal support.')));this.child.once('exit',code=>code===0?resolve():reject(Error('Codex terminal closed unexpectedly. See the preceding error for the cause.')));});
  }
  async close() {
    this.child?.kill();
    this.client?.terminate();
    if(this.server)await new Promise(resolve=>this.server.close(resolve));
    this.token='';
  }
}
