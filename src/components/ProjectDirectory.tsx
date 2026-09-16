'use client';

import type { AgentStatus } from '../lib/agent-status';
import { AgentLights } from './AgentLiveStatus';
import { Badge, Icon } from './ui';

export type DirectoryProject = {
  id: string; public_id:string; name: string; client_label: string; state: 'active' | 'paused' | 'archived'; created_at: string;
  agents: { status: AgentStatus; id: string; name: string; role: 'development' | 'deployment'; active: boolean; environment_id: string; environment_name: string }[];
};

export function ProjectDirectory({ projects, onOpen, onArchive, onDelete, stale }: { stale: boolean; projects: DirectoryProject[]; onOpen: (id: string) => void; onArchive: (project: DirectoryProject) => void; onDelete: (project: DirectoryProject) => void }) {
  return <div className="directory-projects">{projects.map(project => <article className="directory-project" key={project.id} aria-labelledby={`project-${project.id}`}>
    <div className="directory-project-heading"><span className="directory-project-icon"><Icon name="projects"/></span>
      <div className="directory-project-name"><h2 id={`project-${project.id}`}><button className="ticket-open" aria-label={`Open ${project.name}`} onClick={() => onOpen(project.id)}>{project.name}</button></h2><p>{project.client_label}</p></div>
      <Badge tone={project.state === 'active' ? 'success' : 'neutral'}>{project.state === 'active' ? 'Active' : project.state === 'paused' ? 'Paused' : 'Archived'}</Badge>
    </div>
    <div className="directory-assignments">{project.agents.length?project.agents.map(agent=><div className="directory-agent" key={agent.id}><div className="directory-agent-heading"><Icon name={agent.role==='development'?'agents':'settings'}/><strong>{agent.name}</strong><span>{agent.environment_name}</span></div><AgentLights status={agent.status} stale={stale}/></div>):<p className="directory-unassigned">No agents assigned yet.</p>}</div>
    <div className="directory-project-footer"><span>{project.agents.length} assigned {project.agents.length === 1 ? 'identity' : 'identities'}</span><div className="button-row">
      {project.state !== 'archived' && <button className="button button-text" onClick={() => onArchive(project)} aria-label={`Archive ${project.name}`}><Icon name="archive"/>Archive</button>}
      <button className="button button-text ticket-delete" onClick={() => onDelete(project)} aria-label={`Delete ${project.name}`}><Icon name="trash"/>Delete</button>
    </div></div>
  </article>)}</div>;
}
