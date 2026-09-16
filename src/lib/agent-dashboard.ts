import type { AgentStatus } from './agent-status';

type Credential = { agent_id: string; expires_at: string; revoked_at: string | null };
export function agentValidity(agentId: string, credentials: Credential[], now: number) {
  const available = credentials.filter(c => c.agent_id === agentId && !c.revoked_at)
    .map(c => new Date(c.expires_at).getTime()).filter(Number.isFinite).sort((a,b) => a-b);
  const valid = available.filter(expiry => expiry > now);
  const expiry = valid[0] ?? available.at(-1);
  if (expiry === undefined) return { state: 'missing' as const, days: 0, expiry: null, count: 0 };
  const days = Math.max(0, Math.ceil((expiry-now)/86400000));
  return { state: valid.length ? days <= 14 ? 'expiring' as const : 'valid' as const : 'expired' as const, days, expiry: new Date(expiry).toISOString(), count: valid.length };
}
export function matchesAgentFilter(status: AgentStatus | undefined, filter: string, validity: ReturnType<typeof agentValidity>) {
  if (filter === 'all') return true;
  if (!status) return false;
  if (filter === 'connected') return status.connection === 'connected';
  if (filter === 'offline') return status.connection !== 'connected';
  if (filter === 'working') return status.work === 'working';
  if (filter === 'attention') return status.work === 'attention' || status.connection === 'blocked' || ['expired','expiring','missing'].includes(validity.state);
  return true;
}
