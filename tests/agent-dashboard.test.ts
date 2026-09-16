import { describe, expect, it } from 'vitest';
import { agentValidity, matchesAgentFilter } from '../src/lib/agent-dashboard';
import { agentStatus } from '../src/lib/agent-status';

const now=Date.parse('2026-09-10T12:00:00Z');
const credential=(days:number,revoked_at:string|null=null)=>({agent_id:'agent',expires_at:new Date(now+days*86400000).toISOString(),revoked_at});
describe('dashboard access and status reporting',()=>{
  it('shows the next active credential expiry without using revoked credentials',()=>{
    const validity=agentValidity('agent',[credential(60),credential(8),credential(1,new Date(now).toISOString()),credential(-2)],now);
    expect(validity).toMatchObject({state:'expiring',days:8,count:2});
    expect(agentValidity('other',[credential(60)],now).state).toBe('missing');
  });
  it('distinguishes expired and missing access',()=>{
    expect(agentValidity('agent',[credential(-1)],now)).toMatchObject({state:'expired',days:0,count:0});
    expect(agentValidity('agent',[credential(60,new Date(now).toISOString())],now).state).toBe('missing');
    expect(agentValidity('agent',[credential(60)],now).state).toBe('valid');
  });
  it('keeps connection and reported work separate when filtering',()=>{
    const status=agentStatus({active:true,project_state:'active',has_session:true,valid_credential:true,last_seen_at:new Date(now),working:false,waiting:false,recovery:false,paired:true,task_title:null},new Date(now));
    const validity=agentValidity('agent',[credential(60)],now);
    expect(matchesAgentFilter(status,'connected',validity)).toBe(true);
    expect(matchesAgentFilter(status,'working',validity)).toBe(false);
    expect(matchesAgentFilter({...status,work:'working'},'working',validity)).toBe(true);
    expect(matchesAgentFilter(status,'attention',agentValidity('agent',[credential(8)],now))).toBe(true);
  });
});
