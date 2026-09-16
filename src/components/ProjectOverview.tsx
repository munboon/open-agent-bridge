'use client';

import { TitaniumWorkspace } from './TitaniumWorkspace';
import { AgentControlCenter } from './AgentControlCenter';
import type { Snapshot } from './OwnerPortal';
import { Icon } from './ui';

type Props = {
  snapshot: Snapshot;
  stale: boolean;
  onMessage: (id: string) => void;
  onAgents: () => void;
  onTasks: () => void;
  onAudit: () => void;
  onEnvironment: () => void;
  onSettings: () => void;
  onExtend: () => void;
  onRefresh: () => void;
  onConfig: (id: string) => void; onManage: (id:string, action:'revoke'|'state') => void;
};

function recorded(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function eventLabel(value: string) {
  return value.replace(/[_.]/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

export function ProjectOverview({ snapshot, stale, onMessage, onAgents, onAudit, onEnvironment, onExtend, onRefresh, onConfig, onManage }: Props) {
  return <div className="project-overview">
    <TitaniumWorkspace snapshot={snapshot} stale={stale} onMessage={onMessage} onAgents={onAgents} onRefresh={onRefresh}/>
    <details className="titanium-status"><summary>Detailed status and access</summary><AgentControlCenter snapshot={snapshot} stale={stale} onAgents={onAgents} onMessage={onMessage} onExtend={onExtend} onRefresh={onRefresh} onConfig={onConfig} onManage={onManage}/></details>

    <div className="overview-panels">
      <section className="overview-panel environment-panel" aria-labelledby="environments-title">
        <div className="section-heading"><div className="overview-section-title"><Icon name="server"/><h2 id="environments-title">Environments</h2></div><button className="icon-button" aria-label="Add environment" onClick={onEnvironment}><Icon name="plus"/></button></div>
        {snapshot.environments.length ? <div className="overview-environments">{snapshot.environments.map(item => {
          const agents = snapshot.agents.filter(agent => agent.environment_id === item.id);
          return <details key={item.id} className="overview-environment"><summary><Icon name="server"/><strong>{item.name}</strong><span>{agents.length} {agents.length === 1 ? 'agent' : 'agents'}</span><Icon name="chevron"/></summary>
            <div className="environment-members">{agents.length ? agents.map(agent => <div key={agent.id}><strong>{agent.name}</strong><span>{agent.role === 'development' ? 'Development' : 'Deployment'}</span><small>{!agent.active ? 'Access disabled' : agent.has_session ? 'Session registered' : agent.last_seen_at ? 'No registered session' : 'No contact yet'}</small>{agent.last_seen_at && <small>Last contact: {recorded(agent.last_seen_at)}</small>}</div>) : <p>No agent identities in this environment.</p>}<button className="button button-text" onClick={onAgents}>Manage agents<Icon name="arrow"/></button></div>
          </details>;
        })}</div> : <div className="overview-inline-empty"><p>Create an environment to define who can work together.</p><button className="button button-outline" onClick={onEnvironment}>Add environment</button></div>}
      </section>

    <section className="overview-panel overview-activity" aria-labelledby="recent-activity-title">
      <div className="section-heading"><div className="overview-section-title"><Icon name="audit"/><div><h2 id="recent-activity-title">Recent activity</h2><p>Actions recorded by the bridge.</p></div></div><button className="button button-text" onClick={onAudit}>View audit<Icon name="arrow"/></button></div>
      {snapshot.audit.length ? <ol className="overview-timeline">{snapshot.audit.slice(0, 5).map(event => <li key={event.id}><Icon name={event.action.startsWith('credential.') ? 'key' : 'audit'}/><span>{eventLabel(event.action)}</span><time dateTime={event.created_at}>{recorded(event.created_at)}</time></li>)}</ol> : <p className="overview-inline-empty">Setup and access changes will appear here as you use the project.</p>}
    </section>
    </div>
  </div>;
}
