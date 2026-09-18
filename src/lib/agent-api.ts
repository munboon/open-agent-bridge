import {beginContact,finishContact,recordShortPoll,reportContact} from './agent-contact';
import {promptTemplateNames,templateDescriptions,type PromptTemplate} from './agent-instructions';
import {purgePackages} from '../../scripts/package-retention';
import {packageOperation} from './hosted-packages';
import {claimEnrollment} from './agent-enrollment';
import {proofFrom} from './request-proof';
import { hostMetricsSchema } from './host-metrics';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import { accessFrom, agentTransaction, audit, digest, recordAttempt, type AgentAccess } from './agent-auth';
import { acknowledge, appendMessage, conversation, createConversation, history, idempotent, inbox, peer } from './messaging';
import { createTask, listTasks, taskMutation, validateTaskReplay } from './tasks';
import { transferOperation } from './transfers';
import { agentGuides } from './agent-guides';
import { errorResponse, fail, inaccessible, json, plainMessage, readBody, taskAction, taskCreate, uuid } from './protocol';

const processState=globalThis as typeof globalThis & {__bridgeInboxWaits?:Set<string>};
const activePolls=processState.__bridgeInboxWaits??=new Set<string>();
const integerQuery = (url: URL, key: string, fallback: number, max: number) => z.coerce.number().int().min(key==='limit'?1:0).max(max).parse(url.searchParams.get(key) ?? fallback);
export async function handleAgentRequest(request: Request, database: Pool, transport?:'websocket'): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1\/?/,'').split('/').filter(Boolean);
    await recordAttempt(database,request.headers.get('authorization')?.replace(/^Bearer /,'')??'');
    const access = accessFrom(request);
    // Bound JSON requests are capped before hashing; never buffer unbounded input.
    let body:unknown=null;let raw=Buffer.alloc(0);
    if(request.method==='POST'){
      const chunks:Uint8Array[]=[];let size=0;const reader=request.body?.getReader();
      if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>524288){await reader.cancel();fail(413,'BODY_TOO_LARGE','Request exceeds 512 KiB.');}chunks.push(part.value);}
      raw=Buffer.concat(chunks);
      body=await readBody(new Request(request.url,{method:'POST',headers:request.headers,body:raw}));
    }
    access.proof=proofFrom(request,raw);access.enrollment=request.method==='POST'&&path.join('/')==='enrollments/claim';
    if (request.method === 'GET' && path.join('/') === 'events') return await streamInbox(request,database,access,transport??'sse');
    if (request.method === 'GET' && path.join('/') === 'inbox') return await pollInbox(request,database,access,url);
    const method = request.method;

    const result = await agentTransaction(database,access,async (client,who) => {
      if(access.enrollment)return claimEnrollment(client,who,access,body);
      if(path[0]==='packages')return packageOperation(client,who,method,path,body,request.headers.get('Idempotency-Key'));
      if(path[0]==='transfers')return transferOperation(client,who,method,path,body,request.headers.get('Idempotency-Key'));
      if (method === 'GET') {
        if (path.length === 2 && path[0] === 'guides' && Object.hasOwn(agentGuides,path[1])) {
          return {version:'1.2.0',topic:path[1],instructions:agentGuides[path[1] as keyof typeof agentGuides]};
        }
        switch(path.join('/')) {
          case 'bootstrap': return { protocol:{major:1,minor:2}, capabilities:{contact_schedule:true,short_poll_interval_seconds:5,message_transports:[...(process.env.BRIDGE_WEBSOCKET_ENABLED==='1'?['websocket']:[]),'sse','long_poll','short_poll'],websocket_path:process.env.BRIDGE_WEBSOCKET_ENABLED==='1'?'/api/v1/socket':null,events_path:'/api/v1/events',stream_lifetime_seconds:20,heartbeat_seconds:1,receipt_semantics:'retrieved_is_not_accepted'}, identity:{id:who.id,name:who.name,role:who.role,project_id:who.project_id,environment_id:who.environment_id},
            limits:{wait_seconds:20,page_size:100,message_bytes:65536,idle_seconds:null,empty_polls:null},
            session_policy:{idle_timeout:false,rediscover_after_empty_poll:true,close_on:'operator_stop_or_harness_shutdown'},server_time:new Date().toISOString() };
          case 'peers': {
            const limit = integerQuery(url,'limit',50,100);
            const after = url.searchParams.get('after'); if (after) uuid.parse(after);
            const peers = await client.query(`SELECT a.id,a.name,a.role,COALESCE(a.prompt_template,a.role) AS prompt_template,a.description,a.environment_id,e.name AS environment_name,a.last_seen_at,
              (a.session_id IS NOT NULL AND a.last_seen_at>now()-interval '75 seconds') AS connected,
              CASE WHEN k.agent_id IS NULL THEN NULL ELSE jsonb_build_object('scheme',k.scheme,'public_key',k.public_key,'fingerprint',k.fingerprint) END AS recipient_key
              FROM bridge_agents a JOIN bridge_pairings p
              ON (p.agent_a=a.id AND p.agent_b=$1) OR (p.agent_b=a.id AND p.agent_a=$1)
              JOIN bridge_environments e ON e.id=a.environment_id
              LEFT JOIN bridge_recipient_keys k ON k.agent_id=a.id
              WHERE a.active AND ($2::uuid IS NULL OR a.id>$2) ORDER BY a.id LIMIT $3`,[who.id,after,limit+1]);
            return {peers:peers.rows.slice(0,limit).map(agent=>({...agent,role_name:promptTemplateNames[agent.prompt_template as PromptTemplate],description:agent.description??templateDescriptions[agent.prompt_template as PromptTemplate]})),has_more:peers.rows.length>limit};
          }
          case 'tasks': { const after=url.searchParams.get('after'); if(after) uuid.parse(after); return listTasks(client,who,after,integerQuery(url,'limit',50,100)); }
        }
        if(path.length===3&&path[0]==='conversations'&&path[2]==='recipient-key') {
          const convo=await conversation(client,who,uuid.parse(path[1]));
          const recipient=convo.agent_a===who.id?convo.agent_b:convo.agent_a;
          const key=(await client.query('SELECT scheme,public_key,fingerprint FROM bridge_recipient_keys WHERE agent_id=$1',[recipient])).rows[0];
          if(!key)fail(409,'RECIPIENT_KEY_MISSING','The receiving agent must complete file encryption setup first.');
          return {agent_id:recipient,...key};
        }
        if (path.length === 3 && path[0] === 'conversations' && path[2] === 'messages') return history(client,who,uuid.parse(path[1]),integerQuery(url,'after_sequence',0,Number.MAX_SAFE_INTEGER),integerQuery(url,'limit',50,100));
        inaccessible();
      }
      if (method !== 'POST') fail(405,'METHOD_NOT_ALLOWED','Use a supported API method.');
      if(path.join('/')==='recipient-key') {
        const input=z.strictObject({scheme:z.literal('age'),public_key:z.string().regex(/^age1[0-9a-z]{58}$/)}).parse(body);
        const fingerprint=digest(input.public_key);
        const existing=(await client.query('SELECT public_key FROM bridge_recipient_keys WHERE agent_id=$1',[who.id])).rows[0];
        if(existing&&existing.public_key!==input.public_key)fail(409,'RECIPIENT_KEY_CHANGED','A different file encryption key is already registered. Preserve your keys and ask an administrator to authorize recovery.');
        if(!existing){
          await client.query('INSERT INTO bridge_recipient_keys(agent_id,scheme,public_key,fingerprint) VALUES($1,$2,$3,$4)',[who.id,input.scheme,input.public_key,fingerprint]);
          await audit(client,who,'recipient-key.register',who.id);
        }
        return {scheme:input.scheme,public_key:input.public_key,fingerprint};
      }
      if (path.join('/') === 'telemetry') {
        const input=hostMetricsSchema.parse(body);
        if(input.memory_available_bytes>input.memory_total_bytes)fail(422,'INVALID_METRICS','Available memory exceeds total memory.');
        await client.query('UPDATE bridge_agents SET host_metrics=$2::jsonb,host_metrics_at=clock_timestamp() WHERE id=$1',[who.id,JSON.stringify(input)]);
        return {recorded:true};
      }
      if(path.join('/')==='sessions/challenge'){
        const challenge=randomUUID();
        await client.query("UPDATE bridge_credentials SET connection_challenge=$2,challenge_expires_at=now()+interval '1 minute' WHERE id=$1",[who.credential_id,digest(challenge)]);
        return {challenge,expires_in_seconds:60};
      }
      if(path.join('/')==='connection-mode')return reportContact(client,who,body);
      if (path.join('/') === 'sessions') {
        const input=z.strictObject({challenge:z.string().uuid().optional(),takeover_token:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()}).parse(body);
        if (access.session && access.session!==who.session_id) fail(409,'SESSION_CONFLICT','This session was replaced. Stop this adapter.');
        const binding=(await client.query('SELECT device_binding,connection_challenge,challenge_expires_at FROM bridge_credentials WHERE id=$1',[who.credential_id])).rows[0];
        if(binding.device_binding){
          if(!input.challenge||digest(input.challenge)!==binding.connection_challenge||!binding.challenge_expires_at||new Date(binding.challenge_expires_at).getTime()<=Date.now())fail(401,'CONNECTION_CHALLENGE_REQUIRED','Request and sign a fresh connection challenge.');
          await client.query('UPDATE bridge_credentials SET connection_challenge=NULL,challenge_expires_at=NULL WHERE id=$1',[who.credential_id]);
        }
        const required=await client.query('SELECT takeover_digest FROM bridge_agents WHERE id=$1',[who.id]);
        if(input.takeover_token && (!required.rows[0].takeover_digest||digest(input.takeover_token)!==required.rows[0].takeover_digest))fail(409,'TAKEOVER_GRANT_INVALID','This takeover grant has already been consumed or replaced.');
        if(access.proof&&who.session_id){
          const bound=(await client.query('SELECT key_bound FROM bridge_agents WHERE id=$1',[who.id])).rows[0].key_bound;
          if(bound){if(access.session===who.session_id)return {session_id:who.session_id,generation:who.generation};fail(409,'SESSION_CONFLICT','Use the saved session on the registered installation. Close it or request owner recovery before starting another.');}
        }
        const session = randomUUID();
        await client.query("UPDATE bridge_tasks SET state='needs_reconciliation',updated_at=now() WHERE assignee_id=$1 AND state IN ('claimed','cancel_requested')",[who.id]);
        await client.query('UPDATE bridge_agents SET host_metrics=NULL,host_metrics_at=NULL,contact_state=NULL,session_id=$2,generation=generation+1,takeover_digest=NULL WHERE id=$1',[who.id,session]);
        if(who.session_id)await audit(client,who,'session.replaced',who.session_id);
        // Enabled project identities pair across and within environments.
        // Explicit owner blocks survive sign-ins.
        const candidates=await client.query(`SELECT a.id,a.environment_id FROM bridge_agents a
          WHERE a.project_id=$1 AND a.active
          ORDER BY a.id`,[who.project_id]);
        for(let i=0;i<candidates.rows.length;i++) for(let j=i+1;j<candidates.rows.length;j++) {
          const a=candidates.rows[i],b=candidates.rows[j];
          const paired=await client.query('INSERT INTO bridge_pairings(project_id,environment_id,agent_a,agent_b) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM bridge_pairing_blocks WHERE agent_a=$3 AND agent_b=$4) ON CONFLICT DO NOTHING',[who.project_id,a.environment_id,a.id,b.id]);
          if(paired.rowCount)await audit(client,who,'pairing.automatic',b.id);
        }
        await audit(client,who,'session.start',session);
        return {session_id:session,generation:who.generation+1};
      }
      if (path.join('/') === 'sessions/current/close') {
        z.strictObject({}).parse(body);
        await client.query("UPDATE bridge_agents SET session_id=NULL,contact_state=contact_state || jsonb_build_object('next_at',NULL,'listening_until',NULL) WHERE id=$1",[who.id]);
        await client.query("UPDATE bridge_tasks SET state='needs_reconciliation',updated_at=now() WHERE assignee_id=$1 AND state IN ('claimed','cancel_requested')",[who.id]);
        await audit(client,who,'session.close'); return {closed:true};
      }
      if (path.join('/') === 'acknowledgements') {
        const input=z.strictObject({message_ids:z.array(uuid).min(1).max(100)}).parse(body);
        return acknowledge(client,who,input.message_ids);
      }
      const key=request.headers.get('Idempotency-Key');
      if (path.join('/') === 'conversations') {
        const input=z.strictObject({recipient_agent_id:uuid}).parse(body);
        await peer(client,who,input.recipient_agent_id);
        return idempotent(client,who.id,'conversations',key,input,()=>createConversation(client,who,input.recipient_agent_id));
      }
      if (path.join('/') === 'messages') {
        const input=plainMessage.parse(body);
        await conversation(client,who,input.conversation_id,true);
        return idempotent(client,who.id,'messages',key,input,()=>appendMessage(client,who,input));
      }
      if (path.join('/') === 'tasks') {
        const input=taskCreate.parse(body);
        await conversation(client,who,input.conversation_id);
        return idempotent(client,who.id,'tasks',key,input,()=>createTask(client,who,input));
      }
      if (path.length === 3 && path[0] === 'tasks') {
        const id=uuid.parse(path[1]); const input=taskAction.parse(body);
        return idempotent(client,who.id,`tasks/${id}/${path[2]}`,key,input,()=>taskMutation(client,who,id,path[2],input),response=>validateTaskReplay(client,who,id,path[2],response));
      }
      inaccessible();
    }, !(path.join('/') === 'bootstrap' || path.join('/') === 'sessions' || path.join('/') === 'sessions/challenge' || access.enrollment));
    if(path[0]==='packages'&&path.length===3&&['receipt','cancel'].includes(path[2])){try{await purgePackages(database,path[1]);}catch{/* Access is closed; scheduled retention retries file removal. */}}
    return json(result);
  } catch(error) {return errorResponse(error);}
}
async function pollInbox(request: Request, database: Pool, access: AgentAccess, url: URL): Promise<Response> {
  const wait=integerQuery(url,'wait_seconds',0,20); const limit=integerQuery(url,'limit',50,100);
  const identity = await agentTransaction(database,access,async (_client,who)=>who);
  const pollKey=`${identity.id}:${identity.generation}`;
  if (activePolls.has(pollKey)) fail(429,'POLL_ALREADY_ACTIVE','Only one outstanding inbox wait is allowed per session.');
  if (activePolls.size>=100) fail(503,'POLL_CAPACITY','Inbox wait capacity reached. Retry shortly.');
  activePolls.add(pollKey);
  const deadline=Date.now()+wait*1000;
  let lease:string|null=null;
  try {
    lease=await agentTransaction(database,access,(client,who)=>beginContact(client,who,wait>0?'long_poll':null,wait));
    while(true) {
      if(request.signal.aborted) fail(499,'REQUEST_CANCELLED','The client disconnected.');
      // Recheck credential, owner, generation and pairings on every response
      // candidate. No message is retained across a wait outside this transaction.
      const response = await agentTransaction(database,access,async (client,who)=> {
        const batch=await inbox(client,who,limit);
        if(wait===0)await recordShortPoll(client,who);
        return batch.messages.length || Date.now()>=deadline ? json({...batch,server_time:new Date().toISOString()}) : null;
      });
      if(response) return response;
      await new Promise(resolve=>setTimeout(resolve,Math.min(500,deadline-Date.now())));
    }
  } finally {try{await finishContact(database,identity,lease);}finally{activePolls.delete(pollKey);}}
}

// Short-lived SSE connections reauthenticate on reconnect and fence every batch.
async function streamInbox(request:Request,database:Pool,access:AgentAccess,mode:'sse'|'websocket'):Promise<Response> {
  const identity=await agentTransaction(database,access,async(_client,who)=>who);
  const key=`${identity.id}:${identity.generation}`;
  if(activePolls.has(key))fail(429,'POLL_ALREADY_ACTIVE','Only one inbox listener is allowed per session.');
  if(activePolls.size>=100)fail(503,'POLL_CAPACITY','Inbox wait capacity reached. Retry shortly.');
  activePolls.add(key);
  let cancelled=false;
  const encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({
    async start(controller){
      const end=Date.now()+20000;
      const sent=new Set<string>();
      let lease:string|null=null;
      try {
        lease=await agentTransaction(database,access,(client,who)=>beginContact(client,who,mode,20));
        controller.enqueue(encoder.encode(': connected\n\n'));
        while(!cancelled&&!request.signal.aborted&&Date.now()<end){
          // Stop reading the inbox when the consumer stops draining events.
          // Unacknowledged messages remain available on the next connection.
          if((controller.desiredSize??0)<=0)break;
          const batch=await agentTransaction(database,access,async(client,who)=>inbox(client,who,100));
          const fresh=batch.messages.filter(message=>!sent.has(message.id));
          if(fresh.length){fresh.forEach(message=>sent.add(message.id));controller.enqueue(encoder.encode('event: messages\ndata: '+JSON.stringify({messages:fresh})+'\n\n'));}
          else controller.enqueue(encoder.encode(': heartbeat\n\n'));
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
      }catch{if(!cancelled)controller.enqueue(encoder.encode('event: reconnect\ndata: {}\n\n'));}
      finally{try{await finishContact(database,identity,lease);}finally{activePolls.delete(key);if(!cancelled)controller.close();}}
    },
    cancel(){cancelled=true;}
  },{highWaterMark:2});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
}
