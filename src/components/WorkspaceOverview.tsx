'use client';

import {Icon} from './ui';
import type { DirectoryProject } from './ProjectDirectory';

export function WorkspaceOverview({ projects, stale }: { projects: DirectoryProject[]; stale: boolean }) {
  const agents = projects.flatMap(project => project.agents);
  const connected = agents.filter(agent => agent.status?.connection === 'connected');
  const provisioned = agents.filter(agent => agent.status?.provisioned).length;
  const working = connected.filter(agent => agent.status.work === 'working').length;
  const waiting = connected.filter(agent => ['waiting', 'attention'].includes(agent.status.work)).length;
  const unknown = connected.filter(agent => agent.status.work === 'unknown').length;
  return <section className="workspace-summary" aria-labelledby="workspace-summary-title">
    <header><h2 id="workspace-summary-title">Workspace overview</h2><span>{stale ? 'Live status unavailable' : 'Across your accessible projects'}</span></header>
    <dl className="workspace-summary-stats">
      <div><dt><Icon name="projects"/>Projects</dt><dd>{projects.length}</dd><p>{projects.filter(project => project.state === 'active').length} active · {projects.filter(project => project.state === 'paused').length} paused · {projects.filter(project => project.state === 'archived').length} archived</p></div>
      <div><dt><Icon name="agents"/>Agents connected</dt><dd>{stale ? 'Unavailable' : <>{connected.length}<small> / {agents.length}</small></>}</dd><p>{stale ? 'Waiting for the next successful update' : `${agents.length - connected.length} not connected`}</p></div>
      <div><dt><Icon name="shield"/>Access provisioned</dt><dd>{stale ? 'Unavailable' : <>{provisioned}<small> / {agents.length}</small></>}</dd><p>{stale ? 'Credential status cannot be confirmed' : `${agents.length - provisioned} without valid credentials`}</p></div>
      <div><dt><Icon name="tasks"/>Reported work</dt><dd>{stale ? 'Unavailable' : working}<small>{!stale && ' working'}</small></dd><p>{stale ? 'Activity cannot be confirmed' : `${waiting} waiting / attention · ${unknown} unreported`}</p></div>
    </dl>
    <footer>Connection and access describe the same {agents.length === 1 ? 'agent' : 'agents'}. Work status covers connected agents and only reflects activity reported to the bridge.</footer>
  </section>;
}
