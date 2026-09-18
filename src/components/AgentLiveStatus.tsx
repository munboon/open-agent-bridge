'use client';

import {AgentContact} from './AgentContact';
import {Icon} from './ui';
import type { AgentStatus } from '../lib/agent-status';

const connectionLabels = { connected: 'Connected', disconnected: 'Disconnected', not_connected: 'Not connected', setup_needed: 'Setup needed', blocked: 'Access issue' };
const workLabels = { working: 'Working', idle: 'Idle · not working', waiting: 'Waiting for reply', attention: 'Needs attention', unknown: 'Work unknown' };
export function AgentLights({ status, stale = false }: { status?: AgentStatus; stale?: boolean }) {
  if (!status || stale) return <span className="agent-signal signal-unknown"><i aria-hidden="true"/>Status unavailable</span>;
  return <div className="agent-signals"><span className={`agent-signal signal-${status.connection}`}><i aria-hidden="true"/>{connectionLabels[status.connection]}</span><span className={`agent-signal signal-${status.work}`}><i aria-hidden="true"/>{workLabels[status.work]}</span></div>;
}

export function AgentTotals({ agents, stale = false }: { agents: { status?: AgentStatus }[]; stale?: boolean }) {
  const count = (test: (s: AgentStatus) => boolean) => stale ? '—' : agents.filter(a => a.status && test(a.status)).length;
  return <div className="agent-totals" aria-label="Agent status totals">
    <div className="total-assigned"><Icon name="agents"/><strong>{agents.length}</strong><span>Assigned agents</span></div>
    <div className="total-provisioned"><Icon name="key"/><strong>{count(s => s.provisioned)}</strong><span>Provisioned <small>Valid credential</small></span></div>
    <div className="total-connected"><Icon name="link"/><strong>{count(s => s.connection === 'connected')}</strong><span>Connected</span></div>
    <div className="total-disconnected"><Icon name="server"/><strong>{count(s => s.connection !== 'connected')}</strong><span>Not connected</span></div>
    <div className="total-working"><Icon name="bolt"/><strong>{count(s => s.work === 'working')}</strong><span>Working</span></div>
    <div className="total-idle"><Icon name="tasks"/><strong>{count(s => s.work === 'idle' || s.work === 'waiting')}</strong><span>Idle / waiting</span></div>
  </div>;
}

export function AgentMonitor({ agents, environments, onAgents, onMessage, stale }: { agents: { id: string; name: string; role: string; environment_id: string; status?: AgentStatus }[]; environments: {id: string; name: string}[]; onAgents: () => void; onMessage: (id: string) => void; stale: boolean }) {
  return <section className="agent-monitor" aria-labelledby="agent-monitor-title"><div className="section-heading"><div><h2 id="agent-monitor-title">Live agents</h2><p>Connection and work, shown separately.</p></div><button className="button button-outline" onClick={onAgents}>Manage agents</button></div>
    {!agents.length ? <p>No agents assigned. Add a developer and a deployment agent to get started.</p> : <div className="monitor-agents">{agents.map(agent => <article className="monitor-agent" key={agent.id}>
      <div className="monitor-identity"><span>{agent.role === 'development' ? 'Developer' : 'Deployment engineer'}</span><h3>{agent.name}</h3><p>{environments.find(e => e.id === agent.environment_id)?.name ?? 'Environment unavailable'}</p></div>
      <AgentLights status={agent.status} stale={stale}/>
      <p className="monitor-reason">{stale ? 'Live updates unavailable. Reconnect or refresh to verify status.' : agent.status?.reason ?? 'Waiting for status data'}</p>
      {!stale && agent.status?.task_title && <p className="monitor-task">Task: {agent.status.task_title}</p>}
      <AgentContact status={agent.status} stale={stale}/>
      <button className="button button-outline" onClick={() => onMessage(agent.id)}>Message agent</button>
    </article>)}</div>}
    <p className="monitor-legend">Green: recent contact · Red: disconnected or access blocked · Blue: working · Amber: attention needed. Connected means authenticated contact within 75 seconds. Work reflects bridge tasks, not terminal activity.</p>
  </section>;
}
