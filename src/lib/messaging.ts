import { randomUUID } from 'node:crypto';
import type { Transaction } from './db';
import type { AgentIdentity } from './agent-auth';
import { digest } from './agent-auth';
import { fail, inaccessible } from './protocol';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function idempotent<T>(client: Transaction, actor: string, operation: string, key: string | null,
  payload: unknown, work: () => Promise<T>, validateReplay?: (response: T) => Promise<void>): Promise<T> {
  if (!key || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) fail(422,'IDEMPOTENCY_REQUIRED','Supply an Idempotency-Key of 8 to 128 safe characters.');
  const requestDigest = digest(canonical(payload));
  const keyDigest = digest(key);
  const existing = await client.query('SELECT request_digest,response,retired FROM bridge_idempotency WHERE actor_id=$1 AND operation=$2 AND key_digest=$3', [actor,operation,keyDigest]);
  if (existing.rowCount) {
    if(existing.rows[0].retired)fail(410,'IDEMPOTENCY_EXPIRED','The original resource is no longer retained. Reconcile current state instead of replaying it.');
    if (existing.rows[0].request_digest !== requestDigest) fail(409,'IDEMPOTENCY_CONFLICT','This key was already used for a different request.');
    const response = existing.rows[0].response as T;
    if (validateReplay) await validateReplay(response);
    return response;
  }
  const response = await work();
  await client.query('INSERT INTO bridge_idempotency(actor_id,operation,key_digest,request_digest,response) VALUES($1,$2,$3,$4,$5)',
    [actor,operation,keyDigest,requestDigest,JSON.stringify(response)]);
  return response;
}
export async function peer(client: Transaction, who: AgentIdentity, id: string) {
  const found = await client.query(`SELECT a.id,a.name,a.role,a.last_seen_at FROM bridge_agents a JOIN bridge_pairings p
    ON (p.agent_a=a.id AND p.agent_b=$1) OR (p.agent_b=a.id AND p.agent_a=$1)
    WHERE a.id=$2 AND a.active AND a.project_id=$3`, [who.id,id,who.project_id]);
  if (!found.rowCount) inaccessible();
  return found.rows[0];
}
export async function conversation(client: Transaction, who: AgentIdentity, id: string, allowOwner = false) {
  const result = await client.query('SELECT * FROM bridge_conversations WHERE id=$1 AND project_id=$2 AND ($3=agent_a OR $3=agent_b)', [id,who.project_id,who.id]);
  if (!result.rowCount) inaccessible();
  const row = result.rows[0];
  if (row.kind === 'owner') { if (!allowOwner || row.agent_a !== who.id) inaccessible(); return row; }
  await peer(client,who,row.agent_a === who.id ? row.agent_b : row.agent_a);
  return row;
}
export async function createConversation(client: Transaction, who: AgentIdentity, recipient: string) {
  await peer(client,who,recipient);
  const [a,b] = [who.id,recipient].sort();
  const result = await client.query(`INSERT INTO bridge_conversations(id,project_id,environment_id,agent_a,agent_b)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(agent_a,agent_b) DO UPDATE SET agent_a=EXCLUDED.agent_a RETURNING *`,
    [randomUUID(),who.project_id,who.environment_id,a,b]);
  return result.rows[0];
}
export type MessageInput = { conversation_id: string; recipient_agent_id: string; task_id?: string;
  type: string; body: string; resource_id?: string };
export async function appendMessage(client: Transaction, who: AgentIdentity, input: MessageInput) {
  const convo = await conversation(client,who,input.conversation_id,true);
  if (convo.kind === 'owner' && (input.task_id || input.resource_id)) inaccessible();
  const other = convo.agent_a === who.id ? convo.agent_b : convo.agent_a;
  if (other !== input.recipient_agent_id) inaccessible();
  if (input.task_id) {
    const task = await client.query('SELECT id FROM bridge_tasks WHERE id=$1 AND conversation_id=$2',[input.task_id,convo.id]);
    if (!task.rowCount) inaccessible();
  }
  const sequence = await client.query('UPDATE bridge_conversations SET next_sequence=next_sequence+1 WHERE id=$1 RETURNING next_sequence-1 AS sequence',[convo.id]);
  const result = await client.query(`INSERT INTO bridge_messages(id,project_id,environment_id,conversation_id,sequence,sender_id,
    author_type,recipient_agent_id,type,body,task_id,resource_id) VALUES($1,$2,$3,$4,$5,$6,'agent',$7,$8,$9,$10,$11) RETURNING *`,
    [randomUUID(),who.project_id,convo.environment_id,convo.id,sequence.rows[0].sequence,who.id,input.recipient_agent_id,input.type,input.body,input.task_id ?? null,input.resource_id ?? null]);
  if (convo.kind === 'owner') {
    await client.query('UPDATE bridge_messages SET acknowledged_at=now() WHERE id=$1',[result.rows[0].id]);
    result.rows[0].acknowledged_at = new Date().toISOString();
  }
  return result.rows[0];
}
export async function inbox(client: Transaction, who: AgentIdentity, limit: number) {
  // A conversation's sequence is authoritative. Transaction start timestamps
  // can precede lock acquisition; there is deliberately no global message order.
  const messages = await client.query(`SELECT m.* FROM bridge_messages m JOIN bridge_conversations c ON c.id=m.conversation_id
    LEFT JOIN bridge_pairings p ON p.agent_a=c.agent_a AND p.agent_b=c.agent_b
    LEFT JOIN bridge_agents a ON a.id=CASE WHEN c.agent_a=$1 THEN c.agent_b ELSE c.agent_a END
    WHERE m.recipient_agent_id=$1 AND m.acknowledged_at IS NULL
    AND m.project_id=$3
    AND ((c.kind='owner' AND c.agent_a=$1 AND m.author_type='owner') OR (c.kind='peer' AND p.agent_a IS NOT NULL AND a.active))
    ORDER BY m.conversation_id,m.sequence LIMIT $2`,[who.id,limit+1,who.project_id]);
  const rows=messages.rows.slice(0,limit);
  await markRetrieved(client,who,rows);
  return { messages: rows, has_more: messages.rows.length > limit };
}
export async function acknowledge(client: Transaction, who: AgentIdentity, ids: string[]) {
  for (const id of new Set(ids)) {
    const found = await client.query('SELECT conversation_id FROM bridge_messages WHERE id=$1 AND recipient_agent_id=$2',[id,who.id]);
    if (!found.rowCount) inaccessible();
    await conversation(client,who,found.rows[0].conversation_id,true);
    await client.query('UPDATE bridge_messages SET acknowledged_at=COALESCE(acknowledged_at,now()) WHERE id=$1',[id]);
  }
  return { acknowledged: [...new Set(ids)] };
}
export async function history(client: Transaction, who: AgentIdentity, id: string, after: number, limit: number) {
  const convo = await conversation(client,who,id,true);
  const result = await client.query('SELECT * FROM bridge_messages WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',[id,after,limit+1]);
  const rows = result.rows.slice(0,limit);
  await markRetrieved(client,who,rows);
  return { messages: rows, has_more: result.rows.length > limit,
    next_sequence: rows.length ? Number(rows[rows.length-1].sequence) : after,
    retention_gap: after < Number(convo.retained_after) ? { removed_through_sequence: Number(convo.retained_after) } : null };
}

// Record only messages returned to their authenticated recipient. Owner browsing
// and sender history reads must not create delivery receipts.
async function markRetrieved(client:Transaction,who:AgentIdentity,rows:Array<{id:string;recipient_agent_id:string;author_type:string;sender_id:string|null;retrieved_at?:unknown}>) {
  const ids=rows.filter(row=>row.recipient_agent_id===who.id&&row.sender_id!==who.id).map(row=>row.id);
  if(!ids.length)return;
  const updated=await client.query('UPDATE bridge_messages SET retrieved_at=COALESCE(retrieved_at,now()) WHERE id=ANY($1::uuid[]) AND recipient_agent_id=$2 RETURNING id,retrieved_at',[ids,who.id]);
  const stamps=new Map(updated.rows.map(row=>[row.id,row.retrieved_at]));
  for(const row of rows)if(stamps.has(row.id))row.retrieved_at=stamps.get(row.id);
}
