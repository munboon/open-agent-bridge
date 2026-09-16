'use client';

import type { AgentStatus } from '../lib/agent-status';
import { AgentLights } from './AgentLiveStatus';
import { Badge, Icon } from './ui';

export type DirectoryProject = {
  id: string; public_id:string; name: string; client_label: string; state: 'active' | 'paused' | 'archived'; created_at: string;
  administrators?:{name:string;username:string}[];
  agents: { status: AgentStatus; id: string; name: string; role: 'development' | 'deployment'; active: boolean; environment_id: string; environment_name: string }[];
};

export function ProjectDirectory({ projects, onOpen, onArchive, onDelete, stale }: { stale: boolean; projects: DirectoryProject[]; onOpen: (id: string) => void; onArchive: (project: DirectoryProject) => void; onDelete: (project: DirectoryProject) => void }) {
  return <div className="project-ticket-list">{projects.map(project=><article className="project-ticket" key={project.id}>
    <div className="project-ticket-title"><button className="ticket-open" onClick={()=>onOpen(project.id)} aria-label={`Open ${project.name}`}>{project.name}</button><small>{project.client_label}</small><Badge tone={project.state==='active'?'success':'neutral'}>{project.state}</Badge></div>
    <div className="project-ticket-admins"><span className="ticket-column-label">Administrators</span>{project.administrators?.length?project.administrators.map(admin=><span key={admin.username}>{admin.name}</span>):<span>Workspace administrator</span>}</div>
    <div className="project-ticket-agents"><span className="ticket-column-label">Assigned agents</span>{project.agents.length?project.agents.map(agent=><div className="project-ticket-agent" key={agent.id}><span><strong>{agent.name}</strong><small>{agent.environment_name}</small></span><Badge tone={stale?'neutral':agent.status?.provisioned?'success':'warning'}>{stale?'Status unavailable':agent.status?.provisioned?'Provisioned':'Not provisioned'}</Badge><span className="supporting">{stale?'':agent.status?.connection==='connected'?'Connected':'Not connected'}</span></div>):<span>No agents assigned</span>}</div>
    <details className="action-menu"><summary className="button button-outline">Actions<Icon name="chevron"/></summary><div className="menu-panel">{project.state!=='archived'&&<button onClick={()=>onArchive(project)}>Archive project</button>}<button onClick={()=>onDelete(project)}>Delete project</button></div></details>
  </article>)}</div>;
}
