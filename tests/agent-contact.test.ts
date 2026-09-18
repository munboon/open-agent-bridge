import {describe,it,expect} from 'vitest';
import {nextContact} from '../src/lib/agent-contact-labels';
import {agentStatus,type AgentStatus} from '../src/lib/agent-status';
const now=Date.parse('2026-09-18T04:00:00Z');
const status:AgentStatus={connection:'connected',work:'unknown',provisioned:true,reason:'',task_title:null,last_seen_at:new Date(now).toISOString(),sampled_at:new Date(now).toISOString()};
describe('contact expectations',()=>{
 it('counts down to overdue without resetting and expires disconnected evidence',()=>{
  const s={...status,contact:{mode:'short_poll' as const,interval_seconds:5,next_at:new Date(now+5000).toISOString(),listening_until:null}};
  expect(nextContact(s,now)).toBe('In about 5s');expect(nextContact(s,now+3000)).toBe('In about 2s');expect(nextContact(s,now+5000)).toBe('Overdue');expect(nextContact(s,now+75001)).toBe('Unknown');
  expect(nextContact(s,now,true)).toBe('Unavailable');expect(nextContact({...s,connection:'disconnected'},now)).toBe('Unknown');
 });
 it('only calls a current listener live and never invents an old-client schedule',()=>{
  expect(nextContact(status,now)).toBe('Unknown');
  for(const mode of ['websocket','sse','long_poll'] as const){const s={...status,contact:{mode,next_at:null,listening_until:new Date(now+20000).toISOString()}};expect(nextContact(s,now)).toBe('Listening now');expect(nextContact(s,now+20001)).toBe('Unknown');}
  expect(nextContact({...status,contact:{mode:'checkpoint',next_at:null,listening_until:null}},now)).toBe('After current work step');
 });
 it('does not carry a prior session schedule into a replacement',()=>{
  const base={active:true,project_state:'active',has_session:true,valid_credential:true,last_seen_at:new Date(now),working:false,waiting:false,recovery:false,paired:true,task_title:null,generation:2,contact_state:{mode:'sse' as const,generation:1,next_at:null,listening_until:new Date(now+20000).toISOString()}};
  expect(agentStatus(base,new Date(now)).contact).toBeNull();
 });
});
