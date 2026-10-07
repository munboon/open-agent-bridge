import type {ActivityReport} from './workflow-reports';
export type ContactState={mode:'websocket'|'sse'|'long_poll'|'short_poll'|'checkpoint';interval_seconds?:number;next_at:string|null;listening_until:string|null};
export type AgentStatus = {
  connection: 'connected' | 'disconnected' | 'not_connected' | 'setup_needed' | 'blocked';
  work: 'working' | 'idle' | 'waiting' | 'attention' | 'unknown';
  provisioned: boolean;
  reason: string;
  task_title: string | null;
  last_seen_at: string | null;
  sampled_at: string;
  contact?:ContactState|null;
  activity?: (ActivityReport&{stale:boolean}) | null;
};

export function agentStatus(input: {
  active: boolean; project_state: string; has_session: boolean; valid_credential: boolean; has_credential?: boolean;
  last_seen_at: string | Date | null; working: boolean; waiting: boolean; recovery: boolean;
  generation?:number;contact_state?:(ContactState&{generation:number})|null;
  activity_report?:ActivityReport|null;
  paired: boolean; task_title: string | null;
}, now: Date): AgentStatus {
  const seen = input.last_seen_at ? new Date(input.last_seen_at) : null;
  const recent = seen !== null && Number.isFinite(seen.getTime()) && now.getTime() - seen.getTime() <= 75_000;
  const setupNeeded = input.has_credential === false && input.active && input.project_state !== 'archived';
  const blocked = !input.active || input.project_state === 'archived' || !input.valid_credential;
  const connection = setupNeeded ? 'setup_needed' : blocked ? 'blocked' : input.has_session && recent ? 'connected' : seen ? 'disconnected' : 'not_connected';
  const report=input.activity_report;
  const age=report?now.getTime()-new Date(report.reported_at).getTime():Infinity;
  const fresh=!!report&&report.generation===input.generation&&Number.isFinite(age)&&age>=0&&age<=30*60_000&&connection==='connected';
  const activity=report?{...report,stale:!fresh}:null;
  const reportedWork=report?.state==='blocked'?'attention':report?.state==='completed'?'idle':report?.state;
  const work:AgentStatus['work'] = connection !== 'connected' ? 'unknown' : input.recovery ? 'attention' : input.working ? 'working' : input.waiting ? 'waiting' : fresh ? reportedWork??'unknown' : 'unknown';
  const reason = !input.active ? 'Agent access disabled' : input.project_state === 'archived' ? `Project ${input.project_state}` : setupNeeded ? 'Download this agent config to issue its access' : !input.valid_credential ? 'Credential expired or revoked. Replace the agent config in Agents & access' : connection === 'not_connected' ? 'Not launched yet' : connection === 'disconnected' ? input.has_session ? 'No contact in 75 seconds — check the agent terminal' : 'Session closed — launch the agent to reconnect' : input.recovery ? 'Task needs recovery — inspect Tasks' : input.working ? 'Active task claim reported to the bridge' : input.waiting ? 'Waiting for a task reply' : !input.paired ? 'Connected, but no permitted peer — set up pairing' : 'Activity not reported — no active bridge task';
  const saved=input.contact_state;
  const contact=saved&&saved.generation===input.generation?{mode:saved.mode,interval_seconds:saved.interval_seconds,next_at:saved.next_at,listening_until:saved.listening_until}:null;
  return { activity, contact, connection, work, provisioned: input.valid_credential, reason:!input.recovery&&!input.working&&!input.waiting&&connection==='connected'&&activity?activity.stale?'Activity report is stale. Request an update.':`Agent-reported ${report!.state}`:reason, task_title: input.task_title, last_seen_at: seen?.toISOString() ?? null, sampled_at: now.toISOString() };
}
