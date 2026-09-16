'use client';

import {AgentAvatar} from './AgentAvatar';
import { useState } from 'react';
import type { Snapshot } from './OwnerPortal';
import { ConversationPanel } from './ConversationPanel';
import { promptTemplateNames, templateDescriptions } from '../lib/agent-instructions';
import { Icon } from './ui';

type Props = { snapshot: Snapshot; stale: boolean; onMessage: (id: string) => void; onAgents: () => void; onRefresh: () => void };
export function TitaniumWorkspace({snapshot, stale, onMessage, onAgents, onRefresh}: Props) {
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const current = snapshot.agents.find(a => a.id === selected) ?? snapshot.agents[0];
  const role = (a: Snapshot['agents'][number]) => promptTemplateNames[a.prompt_template ?? a.role];
  const status = (a: Snapshot['agents'][number]) => stale ? 'Unavailable' : !a.active ? 'Access disabled' : a.status?.connection === 'connected' ? 'Connected' : 'Not connected';
  const visible = snapshot.agents.filter(a => `${a.name} ${a.description ?? ''} ${role(a)}`.toLowerCase().includes(filter.toLowerCase()));
  const connected = snapshot.agents.filter(a => a.status?.connection === 'connected').length;
  const choose = (id: string) => { setSelected(id); window.scrollTo({top:0, behavior:'instant'}); };
  const avatar = (a: Snapshot['agents'][number]) => <AgentAvatar appearance={a.appearance} className="titanium-avatar"/>;
  return <section className="titanium-workspace" aria-label="Agent conversations">
    <div className="titanium-toolbar"><div className="titanium-agent-switcher" aria-label="Choose an agent">{snapshot.agents.slice(0, 5).map(a => <button key={a.id} onClick={() => choose(a.id)} aria-pressed={current?.id === a.id}><i className={status(a) === 'Connected' ? 'online' : ''}/><span><strong>{a.name}</strong><small>{role(a)}</small></span></button>)}</div><button className="button button-text" onClick={onAgents}><Icon name="settings"/>Manage agents</button></div>
    <div className="titanium-conversation-grid">
      {current && <div className="titanium-quick-chat"><ConversationPanel embedded key={snapshot.project.id} selectionKey={`owner:${current.id}`} initialRecipient={current.id} onSelect={key => {if (key.startsWith('owner:')) setSelected(key.slice(6));}} projectId={snapshot.project.id} agents={snapshot.agents} messages={snapshot.messages} conversations={snapshot.conversations} onSent={onRefresh}/><button className="button button-text titanium-full-chat" onClick={() => onMessage(current.id)}>Open full conversation<Icon name="arrow"/></button></div>}
      <aside className="titanium-directory" aria-label="Project agents"><header><h2>Agents</h2><p>{stale ? 'Connection updates unavailable' : `${connected} connected · ${snapshot.agents.length} in this project`}</p></header><label className="titanium-agent-search"><span className="sr-only">Find an agent</span><input type="search" placeholder="Find an agent…" value={filter} onChange={e => setFilter(e.target.value)}/></label>
        <div className="titanium-agent-rows">{visible.map(a => <button className="titanium-agent-row" key={a.id} onClick={() => choose(a.id)} aria-label={`Message ${a.name}`} aria-pressed={current?.id === a.id}>{avatar(a)}<span><strong>{a.name}</strong><small>{role(a)}</small><span className="titanium-presence"><i className={status(a) === 'Connected' ? 'online' : ''}/>{status(a)}</span></span><Icon name="chevron"/></button>)}</div>
        {!visible.length && <div className="titanium-empty"><h3>{snapshot.agents.length ? 'No matching agents' : 'Add your first agent'}</h3><p>{snapshot.agents.length ? 'Try another name or role.' : 'Create an environment and name the agents who will work there.'}</p><button className="button button-outline" onClick={() => snapshot.agents.length ? setFilter('') : onAgents()}>{snapshot.agents.length ? 'Clear search' : 'Set up agents'}</button></div>}
        {current && <div className="titanium-agent-about"><h3>About {current.name}</h3><p>{current.description || templateDescriptions[current.prompt_template ?? current.role]}</p><span>{stale ? 'Activity unavailable' : current.status?.task_title || 'Work not reported'}</span></div>}
        <p className="titanium-directory-note">Connection status shows whether an agent is reachable. Work is shown only when the agent reports it.</p>
      </aside>
    </div>
  </section>;
}
