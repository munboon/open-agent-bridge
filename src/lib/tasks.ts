import { randomUUID } from 'node:crypto';
import type { Transaction } from './db';
import { audit, type AgentIdentity } from './agent-auth';
import { appendMessage, conversation } from './messaging';
import { fail, inaccessible } from './protocol';

type TaskInput = { conversation_id: string; recipient_agent_id: string; title: string; instructions: string };
type Action = { claim_generation?: number; type?: string; evidence?: string; outcome?: string;
  local_operation_stopped?: boolean; duration_seconds?: number; stage?: string };
const terminal = ['completed','failed','cancelled'];
export async function expireClaims(client: Transaction, who: AgentIdentity) {
  await client.query(`UPDATE bridge_tasks SET state='needs_reconciliation',updated_at=now()
    WHERE project_id=$1 AND state IN ('claimed','cancel_requested') AND lease_until<=now()`,[who.project_id]);
}
export async function createTask(client: Transaction, who: AgentIdentity, input: TaskInput) {
  if (who.project_state !== 'active') fail(409,'PROJECT_PAUSED','The project is not accepting new tasks.');
  const convo = await conversation(client,who,input.conversation_id);
  if (input.recipient_agent_id !== (convo.agent_a === who.id ? convo.agent_b : convo.agent_a)) inaccessible();
  const result = await client.query(`INSERT INTO bridge_tasks(id,project_id,environment_id,conversation_id,requester_id,assignee_id,title,instructions)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[randomUUID(),who.project_id,convo.environment_id,input.conversation_id,who.id,input.recipient_agent_id,input.title,input.instructions]);
  const task = result.rows[0];
  const notification = await appendMessage(client,who,{...input,type:'task_request',body:input.title,task_id:task.id,resource_id:task.id});
  return { task, notification };
}
export async function getTask(client: Transaction, who: AgentIdentity, id: string) {
  await expireClaims(client,who);
  const result = await client.query(`SELECT * FROM bridge_tasks WHERE id=$1 AND project_id=$2
    AND ($3=requester_id OR $3=assignee_id)`,[id,who.project_id,who.id]);
  if (!result.rowCount) inaccessible();
  await conversation(client,who,result.rows[0].conversation_id);
  return result.rows[0];
}
export async function listTasks(client: Transaction, who: AgentIdentity, after: string | null, limit: number) {
  await expireClaims(client,who);
  const result = await client.query(`SELECT t.* FROM bridge_tasks t JOIN bridge_conversations c ON c.id=t.conversation_id
    JOIN bridge_pairings p ON p.agent_a=c.agent_a AND p.agent_b=c.agent_b
    JOIN bridge_agents a ON a.id=CASE WHEN c.agent_a=$2 THEN c.agent_b ELSE c.agent_a END
    WHERE t.project_id=$1 AND ($2=t.requester_id OR $2=t.assignee_id)
    AND a.active AND ($3::uuid IS NULL OR t.id>$3) ORDER BY t.id LIMIT $4`,[who.project_id,who.id,after,limit+1]);
  return { tasks: result.rows.slice(0,limit), has_more: result.rows.length > limit };
}

export async function validateTaskReplay(client: Transaction, who: AgentIdentity, id: string, operation: string, response: unknown): Promise<void> {
  const current = await getTask(client,who,id);
  const cached = response && typeof response === 'object' && 'task' in response ? response.task : null;
  if (!cached || typeof cached !== 'object' || !('id' in cached) || cached.id !== id) {
    fail(409,'IDEMPOTENCY_STALE','The recorded task response cannot be used. Read current task state.');
  }
  const old = cached as Record<string,unknown>;
  const grantsClaim = ['claim','resume','renew','operation-window'].includes(operation)
    || (operation === 'reconcile' && old.state === 'claimed');
  if (grantsClaim && (current.state !== 'claimed' || current.cancellation_requested
    || current.claim_generation !== old.claim_generation || current.session_generation !== old.session_generation
    || current.session_generation !== who.generation || !current.lease_until
    || new Date(current.lease_until).getTime() <= Date.now())) {
    fail(409,'CLAIM_STALE','The recorded claim is no longer valid. Reconcile current task and local state.');
  }
}
export async function taskMutation(client: Transaction, who: AgentIdentity, id: string, operation: string, action: Action) {
  const task = await getTask(client,who,id);
  const assigned = task.assignee_id === who.id;
  if (operation !== 'cancel' && !assigned) inaccessible();
  if (terminal.includes(task.state)) fail(409,'TASK_TERMINAL','A terminal task cannot be changed.');
  let state = task.state;
  let generation = task.claim_generation;
  let sessionGeneration = task.session_generation;
  let cancellationRequested = task.cancellation_requested || task.state === 'cancel_requested';
  let lease = task.lease_until;
  let result = task.result;
  const assertClaim = () => {
    if (!['claimed','cancel_requested'].includes(task.state) || task.session_generation !== who.generation
      || action.claim_generation !== task.claim_generation || !task.lease_until || new Date(task.lease_until).getTime() <= Date.now()) {
      fail(409,'CLAIM_STALE','Reconcile local state before making further changes.');
    }
  };
  const claim = () => {
    if (who.project_state !== 'active') fail(409,'PROJECT_PAUSED','New claims are paused.');
    if (cancellationRequested) fail(409,'CANCEL_REQUESTED','A cancelled request cannot authorize further work. Reconcile the safe-stop outcome.');
    state = 'claimed'; generation += 1; sessionGeneration = who.generation; lease = new Date(Date.now()+300000);
  };
  switch (operation) {
    case 'claim':
      if (state !== 'pending') fail(409,'TASK_STATE','Only pending tasks can be claimed.');
      claim(); break;
    case 'resume':
      if (state !== 'awaiting_reply' || !action.evidence || !action.local_operation_stopped) fail(409,'LOCAL_CHECK_REQUIRED','Resuming requires a reply checkpoint and confirmation no conflicting local operation is running.');
      claim(); break;
    case 'reconcile':
      if (state !== 'needs_reconciliation' || !action.evidence) fail(409,'RECONCILIATION_REQUIRED','Submit local evidence for a task needing reconciliation.');
      if (action.outcome === 'completed') { state='completed'; result={evidence:action.evidence,reported_by:who.id}; }
      else if (action.outcome === 'cancelled') {
        if (!cancellationRequested || !action.local_operation_stopped) fail(409,'SAFE_STOP_REQUIRED','Confirm a safe local stop for the cancellation request.');
        state='cancelled'; result={evidence:action.evidence,reported_by:who.id};
      }
      else if (action.outcome === 'continue' && action.local_operation_stopped) claim();
      else if (action.outcome !== 'uncertain') fail(422,'LOCAL_CHECK_REQUIRED','Confirm local operations stopped before continuing.');
      break;
    case 'renew':
    case 'operation-window':
      assertClaim();
      if (cancellationRequested) fail(409,'CANCEL_REQUESTED','Stop at a safe checkpoint and report the outcome.');
      if (operation === 'operation-window' && (!action.stage || !action.duration_seconds)) fail(422,'STAGE_REQUIRED','Name the stage and its bounded duration.');
      lease = new Date(Date.now()+(operation === 'renew' ? 300 : action.duration_seconds!)*1000); break;
    case 'cancel':
      cancellationRequested=true;
      if (state !== 'needs_reconciliation') state='cancel_requested';
      break;
    case 'events':
      if (!action.evidence || !action.type) fail(422,'EVIDENCE_REQUIRED','Supply the event type and local evidence.');
      if (action.type === 'cancelled') {
        if (state !== 'cancel_requested' || !action.local_operation_stopped) fail(409,'SAFE_STOP_REQUIRED','Confirm a safe local stop.');
        state='cancelled'; result={evidence:action.evidence,reported_by:who.id};
      } else {
        assertClaim();
        if (action.type === 'question') {
          if (!action.local_operation_stopped || cancellationRequested) fail(409,'SAFE_STOP_REQUIRED','Pause local operations before awaiting a reply.');
          state='awaiting_reply'; lease=null;
        } else if (action.type === 'completed' || action.type === 'failed') {
          state=action.type; result={evidence:action.evidence,reported_by:who.id};
        }
      }
      break;
    default: inaccessible();
  }
  const updated = await client.query(`UPDATE bridge_tasks SET state=$2,claim_generation=$3,session_generation=$4,
    lease_until=$5,result=$6,cancellation_requested=$7,updated_at=now() WHERE id=$1 RETURNING *`,[id,state,generation,sessionGeneration,lease,result,cancellationRequested]);
  const notification = await appendMessage(client,who,{conversation_id:task.conversation_id,
    recipient_agent_id:who.id === task.assignee_id ? task.requester_id : task.assignee_id,
    task_id:id,resource_id:id,type:operation === 'cancel' ? 'cancel_request' : action.type === 'question' ? 'question' : 'progress',
    body: action.evidence ?? `Task ${operation}: ${state}${action.stage ? `, stage ${action.stage}` : ''}.`});
  await audit(client,who,`task.${operation}`,id);
  return {task:updated.rows[0],notification};
}
