import type { Transaction } from './db';
import { agentStatus } from './agent-status';

export async function agentStatuses(client: Transaction, ownerId: string, projectId: string | null = null) {
  const rows = await client.query(`SELECT a.id,a.active,p.state project_state,a.session_id IS NOT NULL has_session,a.last_seen_at,
    EXISTS(SELECT 1 FROM bridge_credentials c WHERE c.agent_id=a.id) has_credential,
    EXISTS(SELECT 1 FROM bridge_credentials c WHERE c.agent_id=a.id AND c.revoked_at IS NULL AND c.expires_at>now()) valid_credential,
    EXISTS(SELECT 1 FROM bridge_pairings x WHERE x.agent_a=a.id OR x.agent_b=a.id) paired,
    EXISTS(SELECT 1 FROM bridge_tasks t WHERE t.assignee_id=a.id AND t.state='claimed' AND t.lease_until>now() AND t.session_generation=a.generation) working,
    EXISTS(SELECT 1 FROM bridge_tasks t WHERE t.assignee_id=a.id AND t.state='awaiting_reply') waiting,
    EXISTS(SELECT 1 FROM bridge_tasks t WHERE t.assignee_id=a.id AND (t.state IN ('needs_reconciliation','cancel_requested') OR (t.state='claimed' AND (t.lease_until IS NULL OR t.lease_until<=now() OR t.session_generation IS DISTINCT FROM a.generation)))) recovery,
    (SELECT t.title FROM bridge_tasks t WHERE t.assignee_id=a.id AND t.state IN ('claimed','awaiting_reply','needs_reconciliation','cancel_requested') ORDER BY t.updated_at DESC LIMIT 1) task_title,
    now() sampled_at
    FROM bridge_agents a JOIN bridge_projects p ON p.id=a.project_id WHERE p.owner_id=$1 AND ($2::uuid IS NULL OR p.id=$2)`, [ownerId,projectId]);
  return new Map(rows.rows.map(row => [row.id, agentStatus(row, new Date(row.sampled_at))]));
}
