import { describe, expect, it } from 'vitest';
import { agentStatus } from '../src/lib/agent-status';
describe('agent monitoring truth', () => {
  const now = new Date('2026-09-10T04:00:00Z');
  const base = {active:true,project_state:'active',has_session:true,valid_credential:true,last_seen_at:now,working:false,waiting:false,recovery:false,paired:true,task_title:null};
  it('does not infer idle from connection without a reported task', () => {
    expect(agentStatus(base,now)).toMatchObject({connection:'connected',work:'unknown'});
    expect(agentStatus({...base,working:true},now).work).toBe('working');
  });
  it('does not claim a stale session or stale task is live', () => {
    expect(agentStatus({...base,last_seen_at:new Date(now.getTime()-75001),working:true},now)).toMatchObject({connection:'disconnected',work:'unknown'});
    expect(agentStatus({...base,has_credential:false,valid_credential:false,last_seen_at:null},now)).toMatchObject({connection:'setup_needed',provisioned:false});
    expect(agentStatus({...base,has_credential:true,valid_credential:false},now).connection).toBe('blocked');
    expect(agentStatus({...base,has_session:false,working:true},now).connection).toBe('disconnected');
  });
  it('explains missing credentials and never-launched agents', () => {
    expect(agentStatus({...base,valid_credential:false,last_seen_at:null},now)).toMatchObject({connection:'blocked',provisioned:false});
    expect(agentStatus({...base,has_session:false,last_seen_at:null},now).connection).toBe('not_connected');
  });
  it('reports recovery before work and does not mistake absent pairing for disconnect', () => {
    expect(agentStatus({...base,recovery:true,working:true},now).work).toBe('attention');
    expect(agentStatus({...base,paired:false},now)).toMatchObject({connection:'connected',work:'unknown'});
    expect(agentStatus({...base,project_state:'paused'},now).connection).toBe('connected');
    expect(agentStatus({...base,project_state:'archived'},now).connection).toBe('blocked');
  });
});
