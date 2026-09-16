export type AgentStatus = {
  connection: 'connected' | 'disconnected' | 'not_connected' | 'setup_needed' | 'blocked';
  work: 'working' | 'idle' | 'waiting' | 'attention' | 'unknown';
  provisioned: boolean;
  reason: string;
  task_title: string | null;
  last_seen_at: string | null;
  sampled_at: string;
};

export function agentStatus(input: {
  active: boolean; project_state: string; has_session: boolean; valid_credential: boolean; has_credential?: boolean;
  last_seen_at: string | Date | null; working: boolean; waiting: boolean; recovery: boolean;
  paired: boolean; task_title: string | null;
}, now: Date): AgentStatus {
  const seen = input.last_seen_at ? new Date(input.last_seen_at) : null;
  const recent = seen !== null && Number.isFinite(seen.getTime()) && now.getTime() - seen.getTime() <= 75_000;
  const setupNeeded = input.has_credential === false && input.active && input.project_state !== 'archived';
  const blocked = !input.active || input.project_state === 'archived' || !input.valid_credential;
  const connection = setupNeeded ? 'setup_needed' : blocked ? 'blocked' : input.has_session && recent ? 'connected' : seen ? 'disconnected' : 'not_connected';
  const work = connection !== 'connected' ? 'unknown' : input.recovery ? 'attention' : input.working ? 'working' : input.waiting ? 'waiting' : 'unknown';
  const reason = !input.active ? 'Agent access disabled' : input.project_state === 'archived' ? `Project ${input.project_state}` : setupNeeded ? 'Download this agent config to issue its access' : !input.valid_credential ? 'Credential expired or revoked. Replace the agent config in Agents & access' : connection === 'not_connected' ? 'Not launched yet' : connection === 'disconnected' ? input.has_session ? 'No contact in 75 seconds — check the agent terminal' : 'Session closed — launch the agent to reconnect' : input.recovery ? 'Task needs recovery — inspect Tasks' : input.working ? 'Active task claim reported to the bridge' : input.waiting ? 'Waiting for a task reply' : !input.paired ? 'Connected, but no permitted peer — set up pairing' : 'Activity not reported — no active bridge task';
  return { connection, work, provisioned: input.valid_credential, reason, task_title: input.task_title, last_seen_at: seen?.toISOString() ?? null, sampled_at: now.toISOString() };
}
