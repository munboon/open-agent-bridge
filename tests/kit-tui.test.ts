import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {KitTerminal} from '../scripts/kit-tui.mjs';
import {QuietSession} from '../scripts/quiet-session.mjs';
const {WebSocket}=createRequire(import.meta.url)('next/dist/compiled/ws');
function fixture() {
  const s:any={thread:'agent-thread',threadResult:{thread:{id:'agent-thread'}},initializeResult:{userAgent:'test'},rpc:vi.fn(),drain:vi.fn(),child:{stdin:{write:vi.fn()}}};
  const terminal=new KitTerminal(s);terminal.send=vi.fn();return {s,terminal};
}
describe('native kit terminal',()=>{
  it('rejects unauthenticated clients and browser origins',async()=>{
    const t=await new KitTerminal({}).start();
    try {
      for(const options of [{},{headers:{Authorization:'Bearer '+t.token,Origin:'https://example.test'}}]) {
        const status=await new Promise(resolve=>{const c=new WebSocket(t.url,options);c.on('unexpected-response',(_:unknown,r:any)=>{resolve(r.statusCode);r.destroy();});c.on('error',()=>{});});
        expect(status).toBe(401);
      }
      const c=new WebSocket(t.url,{headers:{Authorization:'Bearer '+t.token}});
      await new Promise((resolve,reject)=>{c.on('open',resolve);c.on('error',reject);});c.terminate();
    } finally {await t.close();}
  });
  it('attaches to the owned conversation without resuming the running server thread',async()=>{
    const {s,terminal}=fixture();s.rpc.mockResolvedValue({thread:{id:s.thread,turns:[]}});
    await terminal.receive({id:1,method:'thread/resume',params:{threadId:s.thread}});
    expect(s.rpc).toHaveBeenCalledExactlyOnceWith('thread/read',{threadId:s.thread,includeTurns:false});
    expect(terminal.send).toHaveBeenCalledWith({id:1,result:{thread:{id:s.thread,turns:[]}}});
  });
  it('fences other threads without rejecting native steering of bridge work',async()=>{
    const {s,terminal}=fixture();s.busy=true;s.state={job:{phase:'dispatching'}};s.save=vi.fn().mockResolvedValue(undefined);
    await terminal.receive({id:1,method:'turn/start',params:{threadId:'other'}});
    expect(s.rpc).not.toHaveBeenCalled();
    s.rpc.mockResolvedValue({turnId:'bridge-turn'});
    const params={threadId:s.thread,expectedTurnId:'bridge-turn',input:[{type:'text',text:'Local instruction'}]};
    await terminal.receive({id:2,method:'turn/steer',params});
    expect(s.state.job.localIntervention).toBe(true);
    expect(s.save).toHaveBeenCalledOnce();
    expect(s.rpc).toHaveBeenCalledExactlyOnceWith('turn/steer',params);
    expect(terminal.send).toHaveBeenLastCalledWith({id:2,result:{turnId:'bridge-turn'}});
    expect(s.externalTurn).toBeUndefined();
  });
  it('routes native approvals back using the original server request id',async()=>{
    const {s,terminal}=fixture();terminal.client={};
    terminal.serverRequest({id:8,method:'approval'});
    await terminal.receive({id:'open-agent-bridge-server-8',result:{decision:'decline'}});
    expect(JSON.parse(s.child.stdin.write.mock.calls[0][0])).toEqual({id:8,result:{decision:'decline'}});
  });
  it('keeps local replies out of portal replies and drains queued bridge work after completion',()=>{
    const s:any=new QuietSession({executable:'unused',cwd:'.',origin:'http://127.0.0.1:3220',token:'synthetic',statePath:'.local/unused'});
    s.output=[];s.externalTurn='local';s.drain=vi.fn();
    s.receive(JSON.stringify({method:'item/completed',params:{item:{type:'agentMessage',text:'private local reply'}}}));
    expect(s.output).toEqual([]);
    s.receive(JSON.stringify({method:'turn/completed',params:{turn:{id:'local',status:'completed'}}}));
    expect(s.externalTurn).toBeNull();expect(s.completed.size).toBe(0);expect(s.drain).toHaveBeenCalledOnce();
  });
});
