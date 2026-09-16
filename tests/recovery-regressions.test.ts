import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOperation } from '../src/lib/admin-service';
import { agentTransaction, recordAttempt, type AgentIdentity } from '../src/lib/agent-auth';
import type { Transaction } from '../src/lib/db';
import { acknowledge, appendMessage, conversation, createConversation, idempotent, inbox } from '../src/lib/messaging';
import { createTask, getTask, listTasks, taskMutation, validateTaskReplay } from '../src/lib/tasks';

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL cancellation and replay regressions', () => {
  let database: Pool;
  const owner = { id: randomUUID(), email: `recovery-${randomUUID()}@example.test` };
  let project: string, environment: string, developer: string, deployment: string, conversationId: string;
  const access = {
    developer: { token: '', session: randomUUID() },
    deployment: { token: '', session: randomUUID() },
  };
  const admin = async (route: string[], body: unknown) => {
    // Bare fixtures: environment provisioning is covered separately.
    if(route.length===3&&route[2]==='environments')return (await database.query('INSERT INTO bridge_environments(id,project_id,name) VALUES($1,$2,$3) RETURNING *',[randomUUID(),route[1],(body as {name:string}).name])).rows[0];
    return adminOperation(database, owner, 'POST', route, body);
  };
  function run<T>(role: keyof typeof access, work: (client: Transaction, who: AgentIdentity) => Promise<T>) {
    return agentTransaction(database, access[role], work, true);
  }
  async function pendingTask() {
    return run('developer', (client, who) => createTask(client, who, {
      conversation_id: conversationId, recipient_agent_id: deployment, title: 'Synthetic recovery task', instructions: 'No external work.',
    }));
  }
  async function claimedTask() {
    const created = await pendingTask();
    return run('deployment', (client, who) => taskMutation(client, who, created.task.id, 'claim', {}));
  }

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55442' || url.pathname !== '/oab_test' || url.username !== 'oab_test') {
      throw new Error('Only the isolated test database is permitted.');
    }
    database = new Pool({ connectionString: url.toString(), max: 4 });
    await database.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())', [owner.id, 'Synthetic recovery owner', owner.email]);
    await database.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)', [owner.id]);
    project = (await admin(['projects'], { name: 'Recovery regressions', client_label: 'Synthetic only' }) as { id: string }).id;
    environment = (await admin(['projects', project, 'environments'], { name: 'Disposable' }) as { id: string }).id;
    developer = (await admin(['projects', project, 'agents'], { name: 'Developer', role: 'development', environment_id: environment }) as { id: string }).id;
    deployment = (await admin(['projects', project, 'agents'], { name: 'Deployment', role: 'deployment', environment_id: (await admin(['projects', project, 'environments'], {name:'Deployment host'}) as {id:string}).id }) as { id: string }).id;
    await admin(['projects', project, 'pairings'], { agent_a: developer, agent_b: deployment });
    access.developer.token = (await admin(['projects', project, 'agents', developer, 'credentials'], {}) as { token: string }).token;
    access.deployment.token = (await admin(['projects', project, 'agents', deployment, 'credentials'], {}) as { token: string }).token;
    // Deliberately different generations expose requester-vs-claimant corruption.
    await database.query('UPDATE bridge_agents SET session_id=$2,generation=7 WHERE id=$1', [developer, access.developer.session]);
    await database.query('UPDATE bridge_agents SET session_id=$2,generation=3 WHERE id=$1', [deployment, access.deployment.session]);
    conversationId = (await run('developer', (client, who) => createConversation(client, who, deployment))).id;
  });

  afterAll(async () => {
    if (!database) return;
    const agents = [developer, deployment].filter(Boolean);
    // Restrict every cleanup statement to this suite's synthetic owner/project.
    for (const table of ['bridge_messages', 'bridge_tasks', 'bridge_conversations', 'bridge_pairings']) {
      await database.query(`DELETE FROM ${table} WHERE project_id=$1`, [project]);
    }
    await database.query('DELETE FROM bridge_credentials WHERE agent_id=ANY($1::uuid[])', [agents]);
    await database.query('DELETE FROM bridge_idempotency WHERE actor_id=ANY($1::text[])', [agents]);
    await database.query('DELETE FROM bridge_rate_windows WHERE actor_id=ANY($1::text[])', [agents]);
    await database.query('DELETE FROM bridge_agents WHERE project_id=$1', [project]);
    await database.query('DELETE FROM bridge_environments WHERE project_id=$1', [project]);
    await database.query('DELETE FROM bridge_audit WHERE owner_id=$1', [owner.id]);
    await database.query('DELETE FROM bridge_projects WHERE owner_id=$1', [owner.id]);
    await database.query('DELETE FROM "user" WHERE id=$1', [owner.id]);
    await database.end();
  });

  it('does not charge an agent for a forged credential with its public identifier', async () => {
    const window=Math.floor(Date.now()/60000);
    const before=await database.query('SELECT count FROM bridge_rate_windows WHERE actor_id=$1 AND window_start=$2',[developer,window]);
    const forged=access.developer.token.split('.')[0]+'.'+'A'.repeat(43);
    try { await recordAttempt(database,forged); } catch(error) {
      // A previously exhausted anonymous bucket still must not debit this agent.
      expect(error).toMatchObject({status:429});
    }
    const after=await database.query('SELECT count FROM bridge_rate_windows WHERE actor_id=$1 AND window_start=$2',[developer,window]);
    expect(after.rows).toEqual(before.rows);
    await recordAttempt(database,access.developer.token);
    const valid=await database.query('SELECT count FROM bridge_rate_windows WHERE actor_id=$1 AND window_start=$2',[developer,window]);
    expect(valid.rows[0].count).toBe((before.rows[0]?.count??0)+1);
  });

  it.each(['revoked', 'expired'])('does not charge the replacement agent budget for a %s credential', async (state) => {
    const old = await admin(['projects', project, 'agents', developer, 'credentials'], {}) as { id: string; token: string };
    const id = old.token.slice(4).split('.')[0];
    if (state === 'revoked') await admin(['projects', project, 'credentials', id, 'revoke'], {});
    else await database.query("UPDATE bridge_credentials SET expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    const before = await database.query('SELECT window_start,count FROM bridge_rate_windows WHERE actor_id=$1 ORDER BY window_start', [developer]);
    try { await recordAttempt(database, old.token); } catch (error) { expect(error).toMatchObject({ status: 429 }); }
    const after = await database.query('SELECT window_start,count FROM bridge_rate_windows WHERE actor_id=$1 ORDER BY window_start', [developer]);
    expect(after.rows).toEqual(before.rows);
    await expect(agentTransaction(database, { token: old.token }, async () => true, false)).rejects.toMatchObject({ status: 401 });
    expect(await run('developer', async () => true)).toBe(true);
  });

  it('preserves the assignee claim when a different-generation requester cancels', async () => {
    const claimed = await claimedTask();
    const cancelled = await run('developer', (client, who) => taskMutation(client, who, claimed.task.id, 'cancel', {}));
    expect(cancelled.task).toMatchObject({ state: 'cancel_requested', cancellation_requested: true, session_generation: 3 });
    const completed = await run('deployment', (client, who) => taskMutation(client, who, claimed.task.id, 'events', {
      type: 'completed', evidence: 'Synthetic operation completed before cancellation arrived.', claim_generation: claimed.task.claim_generation,
    }));
    expect(completed.task).toMatchObject({ state: 'completed', cancellation_requested: true, session_generation: 3 });
  });

  it('keeps cancellation through lease expiry and denies renewed execution', async () => {
    const claimed = await claimedTask();
    await run('developer', (client, who) => taskMutation(client, who, claimed.task.id, 'cancel', {}));
    await database.query("UPDATE bridge_tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [claimed.task.id]);
    const expired = await run('deployment', (client, who) => getTask(client, who, claimed.task.id));
    expect(expired).toMatchObject({ state: 'needs_reconciliation', cancellation_requested: true });
    await expect(run('deployment', (client, who) => taskMutation(client, who, claimed.task.id, 'reconcile', {
      outcome: 'continue', evidence: 'Local work stopped.', local_operation_stopped: true,
    }))).rejects.toMatchObject({ status: 409, code: 'CANCEL_REQUESTED' });
    await expect(run('deployment', (client, who) => taskMutation(client, who, claimed.task.id, 'reconcile', {
      outcome: 'cancelled', evidence: 'Stop not yet confirmed.',
    }))).rejects.toMatchObject({ status: 409, code: 'SAFE_STOP_REQUIRED' });
    const stopped = await run('deployment', (client, who) => taskMutation(client, who, claimed.task.id, 'reconcile', {
      outcome: 'cancelled', evidence: 'Synthetic target unchanged; no local operation running.', local_operation_stopped: true,
    }));
    expect(stopped.task).toMatchObject({ state: 'cancelled', cancellation_requested: true });
  });

  it('allows completed-outcome reconciliation after a cancelled claim expires', async () => {
    const claimed = await claimedTask();
    await run('developer', (client, who) => taskMutation(client, who, claimed.task.id, 'cancel', {}));
    await database.query("UPDATE bridge_tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [claimed.task.id]);
    await expect(run('deployment', (client, who) => taskMutation(client, who, claimed.task.id, 'events', {
      type: 'completed', evidence: 'Stale normal completion.', claim_generation: claimed.task.claim_generation,
    }))).rejects.toMatchObject({ status: 409, code: 'CLAIM_STALE' });
    const result = await run('deployment', (client, who) => taskMutation(client, who, claimed.task.id, 'reconcile', {
      outcome: 'completed', evidence: 'Local ledger and measured version confirm prior completion; no new change.',
    }));
    expect(result.task).toMatchObject({ state: 'completed', cancellation_requested: true });
  });

  it('allows a safe stop of work cancelled before it was claimed', async () => {
    const created = await pendingTask();
    await run('developer', (client, who) => taskMutation(client, who, created.task.id, 'cancel', {}));
    const result = await run('deployment', (client, who) => taskMutation(client, who, created.task.id, 'events', {
      type: 'cancelled', evidence: 'No local operation was started.', local_operation_stopped: true,
    }));
    expect(result.task).toMatchObject({ state: 'cancelled', cancellation_requested: true, session_generation: null });
  });

  it('hides tasks consistently when the counterpart is disabled', async () => {
    const created = await pendingTask();
    await admin(['projects', project, 'agents', developer, 'state'], { active: false });
    try {
      expect((await run('deployment', (client, who) => listTasks(client, who, null, 100))).tasks).toEqual([]);
      await expect(run('deployment', (client, who) => getTask(client, who, created.task.id))).rejects.toMatchObject({ status: 404 });
    } finally {
      await admin(['projects', project, 'agents', developer, 'state'], { active: true });
    }
  });

  it('rechecks access instead of returning an old message response after unpairing', async () => {
    const key = randomUUID();
    const input = { conversation_id: conversationId, recipient_agent_id: deployment, type: 'note', body: 'Synthetic cached message' };
    const send = () => run('developer', (client, who) => idempotent(client, who.id, 'regression-message', key, input,
      () => appendMessage(client, who, input), async () => { await conversation(client, who, conversationId); }));
    const original = await send();
    expect((await send()).id).toBe(original.id);
    await admin(['projects', project, 'pairings'], { agent_a: developer, agent_b: deployment, enabled: false });
    try { await expect(send()).rejects.toMatchObject({ status: 404 }); }
    finally { await admin(['projects', project, 'pairings'], { agent_a: developer, agent_b: deployment, enabled: true }); }
    expect(Number((await database.query('SELECT count(*) FROM bridge_messages WHERE id=$1', [original.id])).rows[0].count)).toBe(1);
  });

  it('rejects cached claim success after cancellation or session replacement', async () => {
    const created = await pendingTask();
    const id = created.task.id, key = randomUUID();
    const claim = () => run('deployment', (client, who) => idempotent(client, who.id, 'regression-claim', key, {},
      () => taskMutation(client, who, id, 'claim', {}), (response) => validateTaskReplay(client, who, id, 'claim', response)));
    const original = await claim();
    expect((await claim()).task.claim_generation).toBe(original.task.claim_generation);
    const previousSession = access.deployment.session;
    access.deployment.session = randomUUID();
    await database.query('UPDATE bridge_agents SET session_id=$2,generation=4 WHERE id=$1', [deployment, access.deployment.session]);
    try { await expect(claim()).rejects.toMatchObject({ status: 409, code: 'CLAIM_STALE' }); }
    finally {
      access.deployment.session = previousSession;
      await database.query('UPDATE bridge_agents SET session_id=$2,generation=3 WHERE id=$1', [deployment, previousSession]);
    }
    await run('developer', (client, who) => taskMutation(client, who, id, 'cancel', {}));
    await expect(claim()).rejects.toMatchObject({ status: 409, code: 'CLAIM_STALE' });
  });

  it('delivers conversation sequence order even when transaction timestamps disagree', async () => {
    const previous = await run('deployment', (client, who) => inbox(client, who, 100));
    if (previous.messages.length) await run('deployment', (client, who) => acknowledge(client, who, previous.messages.map((item) => item.id)));
    const send = (body: string) => run('developer', (client, who) => appendMessage(client, who, {
      conversation_id: conversationId, recipient_agent_id: deployment, type: 'note', body,
    }));
    const first = await send('Sequence first'), second = await send('Sequence second');
    await database.query("UPDATE bridge_messages SET created_at=now()+interval '1 minute' WHERE id=$1", [first.id]);
    await database.query("UPDATE bridge_messages SET created_at=now()-interval '1 minute' WHERE id=$1", [second.id]);
    const result = await run('deployment', (client, who) => inbox(client, who, 100));
    expect(result.messages.map((message) => message.id)).toEqual([first.id, second.id]);
  });
});
