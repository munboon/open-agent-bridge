import {appearanceSchema} from './agent-appearance-schema';
import {promptTemplateSchema,workInstructionsSchema,requireCustomInstructions} from './agent-template-schema';
import {codexInstructions,roleWorkInstructions,promptTemplateNames,templateDescriptions,type PromptTemplate} from './agent-instructions';
import {operationalInstructions,startupInstructions} from '../../scripts/kit-prompts.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { prepareAgentAccess } from './kit-access';
import { agentStatuses } from './agent-monitor';
import { z } from 'zod';
import type { Pool } from 'pg';
import { transaction, type Transaction } from './db';
import { audit, digest, newCredential } from './agent-auth';
import { fail, inaccessible, label, uuid } from './protocol';
import { messageBody } from './protocol';
import { idempotent } from './messaging';

export type Owner = { id: string; email: string };
export async function ownerTransaction<T>(database: Pool, owner: Owner, work: (client: Transaction)=>Promise<T>) {
  return transaction(database,async client=> {
    const state=await client.query('SELECT active FROM bridge_owner_state WHERE owner_id=$1 FOR UPDATE',[owner.id]);
    if(!state.rows[0]?.active) fail(403,'OWNER_DISABLED','Owner administration is unavailable.');
    return work(client);
  });
}
async function projectFor(client: Transaction,owner: Owner,id: string) {
  const result=await client.query('SELECT * FROM bridge_projects WHERE id=$1 AND owner_id=$2',[id,owner.id]);
  if(!result.rowCount) inaccessible();
  return result.rows[0];
}
export async function adminOperation(database: Pool,owner: Owner,method: string,path: string[],body: unknown,options:{key?:string|null;query?:URLSearchParams}={}) {
  return ownerTransaction(database,owner,async client=> {
    if(method==='GET' && path.length===0) {
      const projects=await client.query(`SELECT p.*,COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'name',a.name,'role',a.role,'active',a.active,'environment_id',a.environment_id,'environment_name',e.name
        ) ORDER BY a.name,a.id) FROM bridge_agents a JOIN bridge_environments e ON e.id=a.environment_id
        WHERE a.project_id=p.id),'[]'::jsonb) AS agents
        FROM bridge_projects p WHERE p.owner_id=$1 ORDER BY p.created_at DESC`,[owner.id]);
      const statuses=await agentStatuses(client,owner.id);
      return {projects:projects.rows.map(project=>({...project,agents:project.agents.map((agent:{id:string})=>({...agent,status:statuses.get(agent.id)}))}))};
    }
    if(method==='POST' && path.join('/')==='projects') {
      const input=z.strictObject({name:label,client_label:label}).parse(body);
      const row=await client.query('INSERT INTO bridge_projects(id,owner_id,name,client_label) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),owner.id,input.name,input.client_label]);
      await audit(client,{id:owner.id,owner_id:owner.id,project_id:row.rows[0].id},'project.create',row.rows[0].id);
      return row.rows[0];
    }
    if(path[0]!=='projects' || path.length<2) inaccessible();
    const id=uuid.parse(path[1]);
    await projectFor(client,owner,id);
    const actor={id:owner.id,owner_id:owner.id,project_id:id};
    if(method==='GET'&&path.length===6&&path[2]==='agents'&&path[4]==='enrollments') {
      const row=(await client.query(`SELECT CASE WHEN k.bound_at IS NOT NULL THEN 'claimed' WHEN k.revoked_at IS NOT NULL THEN 'revoked' WHEN k.enrollment_expires_at<=now() OR k.expires_at<=now() THEN 'expired' ELSE 'pending' END AS status,k.enrollment_expires_at AS expires_at,k.bound_at AS registered_at FROM bridge_credentials k JOIN bridge_agents a ON a.id=k.agent_id WHERE k.id=$1 AND a.id=$2 AND a.project_id=$3 AND k.enrollment_expires_at IS NOT NULL`,[uuid.parse(path[5]),uuid.parse(path[3]),id])).rows[0];
      if(!row)inaccessible();return row;
    }
    if(method==='GET'&&path.length===4&&path[2]==='portal-thread'){
      const token=z.string().regex(/^[ac][a-f0-9]{10}$/).parse(path[3]);
      if(token[0]==='a'){
        const row=(await client.query('SELECT id FROM bridge_agents WHERE project_id=$1 AND public_id=$2',[id,token.slice(1)])).rows[0];
        if(!row)inaccessible();return {selection:'owner:'+row.id};
      }
      const row=(await client.query('SELECT * FROM bridge_conversations WHERE project_id=$1 AND public_id=$2',[id,token.slice(1)])).rows[0];
      if(!row)inaccessible();return {selection:row.agent_a===row.agent_b?'owner:'+row.agent_a:row.id,conversation:row};
    }
    if((method==='GET'||method==='POST')&&path.length===5&&path[2]==='agents'&&path[4]==='instructions') {
      const agentId=uuid.parse(path[3]);
      const result=await client.query(`SELECT a.name,a.role,a.description,a.appearance,COALESCE(a.chat_visible,a.role='development') AS chat_visible,a.prompt_template,a.work_instructions,a.instructions_revision,p.name AS project_name FROM bridge_agents a JOIN bridge_projects p ON p.id=a.project_id WHERE a.id=$1 AND a.project_id=$2`,[agentId,id]);
      if(!result.rowCount)inaccessible();
      const agent=result.rows[0];
      if(method==='POST') {
        const input=z.strictObject({appearance:appearanceSchema.optional(),description:z.string().trim().max(1000).nullable().optional(),name:label.optional(),chat_visible:z.boolean().optional(),prompt_template:promptTemplateSchema,work_instructions:workInstructionsSchema.nullable(),expected_revision:z.number().int().nonnegative()}).superRefine(requireCustomInstructions).parse(body);
        if(input.expected_revision!==agent.instructions_revision)fail(409,'INSTRUCTIONS_CHANGED','This prompt changed in another session. Copy your draft, then reopen the editor to review the latest version.');
        await client.query('UPDATE bridge_agents SET work_instructions=$2,prompt_template=$4,name=$5,chat_visible=$6,description=$7,appearance=$8,instructions_revision=instructions_revision+1 WHERE id=$1 AND project_id=$3',[agentId,input.work_instructions,id,input.prompt_template,input.name??agent.name,input.chat_visible??agent.chat_visible,input.description===undefined?agent.description:input.description,input.appearance??agent.appearance]);
        agent.appearance=input.appearance??agent.appearance;
        agent.name=input.name??agent.name;
        agent.chat_visible=input.chat_visible??agent.chat_visible;
        if(input.description!==undefined)agent.description=input.description;
        agent.work_instructions=input.work_instructions;
        agent.prompt_template=input.prompt_template;
        agent.instructions_revision++;
        await audit(client,actor,'agent.instructions.update',agentId);
      }
      return {appearance:agent.appearance,description:agent.description??templateDescriptions[(agent.prompt_template??agent.role) as PromptTemplate],name:agent.name,chat_visible:agent.chat_visible,prompt_template:agent.prompt_template??agent.role,templates:Object.entries(promptTemplateNames).map(([id,name])=>({id,name,instructions:roleWorkInstructions(id)})),instructions:codexInstructions(agent,agentId),work_instructions:agent.work_instructions??roleWorkInstructions(agent.prompt_template??agent.role),default_instructions:roleWorkInstructions(agent.prompt_template??agent.role),customized:agent.work_instructions!==null,revision:agent.instructions_revision,runtime:operationalInstructions,startup:startupInstructions(agent.name)};
    }

    if(method==='GET'&&path.length===5&&path[2]==='conversations'&&path[4]==='messages') {
      const conversationId=uuid.parse(path[3]);
      const convo=await client.query('SELECT retained_after FROM bridge_conversations WHERE id=$1 AND project_id=$2',[conversationId,id]);
      if(!convo.rowCount)inaccessible();
      const after=z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(options.query?.get('after_sequence')??0);
      const before=options.query?.has('before_sequence')?z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(options.query.get('before_sequence')):null;
      const rows=before===null
        ?await client.query('SELECT * FROM bridge_messages WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101',[conversationId,after])
        :await client.query('SELECT * FROM bridge_messages WHERE conversation_id=$1 AND sequence<$2 ORDER BY sequence DESC LIMIT 101',[conversationId,before]);
      const page=rows.rows.slice(0,100);
      const messages=before===null?page:page.reverse();
      return {messages,has_more:rows.rows.length>100,next_sequence:messages.length?Number(messages[before===null?messages.length-1:0].sequence):(before??after),
        retention_gap:Number(convo.rows[0].retained_after)>0&&(before!==null||after<Number(convo.rows[0].retained_after))?{removed_through_sequence:Number(convo.rows[0].retained_after)}:null};
    }
    if(method==='GET' && path.length===2) {
      const environments=await client.query('SELECT * FROM bridge_environments WHERE project_id=$1 ORDER BY name',[id]);
      const agents=await client.query(`SELECT a.id,a.public_id,a.name,a.role,a.description,a.appearance,COALESCE(a.prompt_template,a.role) AS prompt_template,COALESCE(a.chat_visible,a.role='development') AS chat_visible,a.environment_id,a.active,a.generation,a.last_seen_at,a.host_metrics,a.host_metrics_at,(a.session_id IS NOT NULL) AS has_session,
        CASE WHEN k.agent_id IS NULL THEN NULL ELSE jsonb_build_object('scheme',k.scheme,'public_key',k.public_key,'fingerprint',k.fingerprint) END AS recipient_key
        FROM bridge_agents a LEFT JOIN bridge_recipient_keys k ON k.agent_id=a.id WHERE a.project_id=$1 ORDER BY a.name`,[id]);
      const credentials=await client.query(`SELECT k.id,k.agent_id,k.expires_at,k.revoked_at,k.created_at,(k.kit_envelope IS NOT NULL AND k.revoked_at IS NULL AND k.expires_at>now()) AS download_pending FROM bridge_credentials k
        JOIN bridge_agents a ON a.id=k.agent_id WHERE a.project_id=$1 ORDER BY k.created_at DESC`,[id]);
      const conversations=await client.query('SELECT * FROM bridge_conversations WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',[id]);
      const tasks=await client.query('SELECT * FROM bridge_tasks WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',[id]);
      const messages=await client.query('SELECT * FROM bridge_messages WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',[id]);
      const events=await client.query('SELECT id,actor_id,action,resource_id,created_at FROM bridge_audit WHERE project_id=$1 ORDER BY id DESC LIMIT 100',[id]);
      const pairings=await client.query('SELECT agent_a,agent_b,environment_id FROM bridge_pairings WHERE project_id=$1',[id]);
      const transfers=await client.query(`SELECT t.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'origin',o.origin,'expires_at',o.expires_at,'revoked_at',o.revoked_at,'cleanup_state',o.cleanup_state) ORDER BY o.created_at,o.id) FROM bridge_offers o WHERE o.transfer_id=t.id),'[]'::jsonb) AS offers,
        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM bridge_receipts r WHERE r.transfer_id=t.id),'[]'::jsonb) AS receipts
        FROM bridge_transfers t WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100`,[id]);
      const packages=await client.query("SELECT id,filename,size,sha256,sender_id,recipient_id,CASE WHEN expires_at<=now() THEN 'expired' ELSE state END AS state,expires_at,verified_at,purged_at,created_at FROM bridge_packages WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",[id]);
      const statuses=await agentStatuses(client,owner.id,id);
      return {project:await projectFor(client,owner,id),environments:environments.rows,agents:agents.rows.map(agent=>({...agent,status:statuses.get(agent.id)})),credentials:credentials.rows,
        conversations:conversations.rows,tasks:tasks.rows,messages:messages.rows,audit:events.rows,pairings:pairings.rows,transfers:transfers.rows,packages:packages.rows};
    }
    if(method!=='POST') fail(405,'METHOD_NOT_ALLOWED','Use a supported admin method.');
    if(path.length===3&&path[2]==='extend-validity') {
      const input=z.strictObject({days:z.number().int().min(1).max(90)}).parse(body);
      return idempotent(client,owner.id,`admin/${id}/extend-validity`,options.key??null,input,async()=> {
        const updated=await client.query(`UPDATE bridge_credentials k
          SET expires_at=GREATEST(k.expires_at,now())+$2*interval '1 day'
          FROM bridge_agents a WHERE k.agent_id=a.id AND a.project_id=$1 AND k.revoked_at IS NULL
          RETURNING k.id,k.agent_id`,[id,input.days]);
        const agentsExtended=new Set(updated.rows.map(row=>row.agent_id)).size;
        const total=await client.query('SELECT count(*) FROM bridge_agents WHERE project_id=$1',[id]);
        await audit(client,actor,'credentials.extend',id);
        return {days:input.days,agents_extended:agentsExtended,credentials_extended:updated.rowCount??0,agents_skipped:Number(total.rows[0].count)-agentsExtended};
      });
    }
    if(path.length===3&&path[2]==='delete') {
      const input=z.strictObject({confirm_name:z.string()}).parse(body);
      const project=await projectFor(client,owner,id);
      if(input.confirm_name!==project.name)fail(422,'CONFIRMATION_REQUIRED','Type the exact project name to delete it.');
      // The owner lock also serializes agent operations and waiting response release.
      // Remove only this project's records, including durable replay responses.
      const agents=(await client.query('SELECT id FROM bridge_agents WHERE project_id=$1',[id])).rows.map(row=>row.id);
      await client.query(`DELETE FROM bridge_idempotency WHERE actor_id=ANY($1::text[]) OR
        (actor_id=$2 AND (operation=$3 OR operation=$5 OR operation IN (SELECT 'admin/tasks/'||id::text||'/cancel' FROM bridge_tasks WHERE project_id=$4)))`,[agents,owner.id,`admin/${id}/messages`,id,`admin/${id}/extend-validity`]);
      await client.query('DELETE FROM bridge_rate_windows WHERE actor_id=ANY($1::text[])',[agents]);
      await client.query('DELETE FROM bridge_receipts WHERE transfer_id IN (SELECT id FROM bridge_transfers WHERE project_id=$1)',[id]);
      await client.query('DELETE FROM bridge_offers WHERE transfer_id IN (SELECT id FROM bridge_transfers WHERE project_id=$1)',[id]);
      for(const table of ['bridge_transfers','bridge_messages','bridge_tasks','bridge_conversations','bridge_pairings'])await client.query(`DELETE FROM ${table} WHERE project_id=$1`,[id]);
      for(const table of ['bridge_credentials','bridge_recipient_keys'])await client.query(`DELETE FROM ${table} WHERE agent_id=ANY($1::uuid[])`,[agents]);
      await client.query('DELETE FROM bridge_agents WHERE project_id=$1',[id]);
      await client.query('DELETE FROM bridge_environments WHERE project_id=$1',[id]);
      await client.query('DELETE FROM bridge_audit WHERE project_id=$1',[id]);
      await client.query('DELETE FROM bridge_projects WHERE id=$1',[id]);
      await audit(client,{id:owner.id,owner_id:owner.id},'project.delete',id);
      return {deleted:true,id};
    }
    if(path.length===3&&path[2]==='messages') {
      const input=z.strictObject({conversation_id:uuid.optional(),recipient_agent_id:uuid,body:messageBody}).parse(body);
      const recipient=await client.query('SELECT id,environment_id FROM bridge_agents WHERE id=$1 AND project_id=$2',[input.recipient_agent_id,id]);
      if(!recipient.rowCount)inaccessible();
      let conversationId=input.conversation_id;
      if(!conversationId) {
        const direct=await client.query(`INSERT INTO bridge_conversations(id,project_id,environment_id,agent_a,agent_b,kind)
          VALUES($1,$2,$3,$4,$4,'owner') ON CONFLICT(agent_a,agent_b) DO UPDATE SET agent_a=EXCLUDED.agent_a RETURNING id`,[randomUUID(),id,recipient.rows[0].environment_id,input.recipient_agent_id]);
        conversationId=direct.rows[0].id;
      }
      const convo=await client.query('SELECT * FROM bridge_conversations WHERE id=$1 AND project_id=$2 AND ($3=agent_a OR $3=agent_b)',[conversationId,id,input.recipient_agent_id]);
      if(!convo.rowCount)inaccessible();
      return idempotent(client,owner.id,`admin/${id}/messages`,options.key??null,input,async()=> {
        const message=await ownerMessage(client,owner,convo.rows[0],input.recipient_agent_id,'note',input.body);
        await audit(client,actor,'owner.message',message.id);return message;
      });
    }
    if(path.length===5&&path[2]==='tasks'&&path[4]==='cancel') {
      const taskId=uuid.parse(path[3]);const input=z.strictObject({evidence:messageBody}).parse(body);
      const found=await client.query('SELECT * FROM bridge_tasks WHERE id=$1 AND project_id=$2',[taskId,id]);if(!found.rowCount)inaccessible();
      return idempotent(client,owner.id,`admin/tasks/${taskId}/cancel`,options.key??null,input,async()=> {
        const task=found.rows[0];
        if(['completed','failed','cancelled'].includes(task.state))fail(409,'TASK_TERMINAL','The task already has a terminal outcome.');
        await client.query("UPDATE bridge_tasks SET cancellation_requested=true,state=CASE WHEN state='needs_reconciliation' THEN state ELSE 'cancel_requested' END,updated_at=now() WHERE id=$1",[taskId]);
        const convo=(await client.query('SELECT * FROM bridge_conversations WHERE id=$1',[task.conversation_id])).rows[0];
        const messages=[];
        for(const recipient of [task.requester_id,task.assignee_id])messages.push(await ownerMessage(client,owner,convo,recipient,'cancel_request',input.evidence,taskId));
        await audit(client,actor,'owner.task.cancel',taskId);return {cancel_requested:true,notifications:messages};
      });
    }
    if(path.length===3 && path[2]==='state') {
      const input=z.strictObject({state:z.enum(['active','paused','archived'])}).parse(body);
      await client.query('UPDATE bridge_projects SET state=$2 WHERE id=$1',[id,input.state]);
      await audit(client,actor,`project.${input.state}`,id); return {state:input.state};
    }
    if(path.length===3 && path[2]==='environments') {
      const input=z.strictObject({name:label.max(114),create_agent:z.boolean().default(true),role:z.enum(['development','deployment']).default('deployment'),prompt_template:promptTemplateSchema.optional(),work_instructions:workInstructionsSchema.nullable().optional()}).superRefine(requireCustomInstructions).parse(body);
      const template=input.prompt_template??input.role;
      const transportRole=template==='development'?'development':'deployment';
      const result=await client.query('INSERT INTO bridge_environments(id,project_id,name) VALUES($1,$2,$3) RETURNING *',[randomUUID(),id,input.name]);
      const environment=result.rows[0];
      await audit(client,actor,'environment.create',environment.id);
      if(!input.create_agent)return environment;
      const agentId=randomUUID();
      await client.query('INSERT INTO bridge_agents(id,project_id,environment_id,name,role,prompt_template,work_instructions) VALUES($1,$2,$3,$4,$5,$6,$7)',[agentId,id,environment.id,`${input.name} Agent`,transportRole,template,input.work_instructions??null]);
      await audit(client,actor,'agent.create',agentId);
      await prepareAgentAccess(client,owner.id,id,agentId);
      return environment;
    }
    if(path.length===3 && path[2]==='agents') {
      const input=z.strictObject({name:z.string().trim().max(120).optional(),environment_id:uuid,role:z.enum(['development','deployment']).default('development'),prompt_template:promptTemplateSchema.optional(),work_instructions:workInstructionsSchema.nullable().optional()}).superRefine(requireCustomInstructions).parse(body);
      const template=input.prompt_template??input.role;
      const transportRole=template==='development'?'development':'deployment';
      const env=await client.query('SELECT id FROM bridge_environments WHERE id=$1 AND project_id=$2',[input.environment_id,id]);
      if(!env.rowCount) inaccessible();
      const result=await client.query('INSERT INTO bridge_agents(id,project_id,environment_id,name,role,prompt_template,work_instructions) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,role,prompt_template,environment_id',[randomUUID(),id,input.environment_id,input.name || (template==='development'?'Developer':promptTemplateNames[template]+' Agent'),transportRole,template,input.work_instructions??null]);
      await audit(client,actor,'agent.create',result.rows[0].id);return result.rows[0];
    }
    if(path.length===4 && path[2]==='pairings' && path[3]==='bulk') {
      const input=z.strictObject({enabled:z.boolean(),agent_id:uuid.optional(),expected_agent_ids:z.array(uuid).max(1000)}).parse(body);
      const agents=await client.query('SELECT id FROM bridge_agents WHERE project_id=$1 ORDER BY id',[id]);
      if(input.agent_id&&!agents.rows.some(agent=>agent.id===input.agent_id))inaccessible();
      if(JSON.stringify(agents.rows.map(agent=>agent.id))!==JSON.stringify([...input.expected_agent_ids].sort()))fail(409,'AGENTS_CHANGED','The project agents changed. Refresh and review this action again.');
      const scope=input.agent_id??null;
      if(input.enabled) {
        await client.query('DELETE FROM bridge_pairing_blocks WHERE project_id=$1 AND ($2::uuid IS NULL OR agent_a=$2 OR agent_b=$2)',[id,scope]);
        await client.query(`INSERT INTO bridge_pairings(project_id,environment_id,agent_a,agent_b)
          SELECT a.project_id,a.environment_id,a.id,b.id FROM bridge_agents a JOIN bridge_agents b ON a.project_id=b.project_id AND a.id<b.id
          WHERE a.project_id=$1 AND ($2::uuid IS NULL OR a.id=$2 OR b.id=$2) ON CONFLICT DO NOTHING`,[id,scope]);
      } else {
        await client.query(`INSERT INTO bridge_pairing_blocks(project_id,agent_a,agent_b)
          SELECT a.project_id,a.id,b.id FROM bridge_agents a JOIN bridge_agents b ON a.project_id=b.project_id AND a.id<b.id
          WHERE a.project_id=$1 AND ($2::uuid IS NULL OR a.id=$2 OR b.id=$2) ON CONFLICT DO NOTHING`,[id,scope]);
        await client.query('DELETE FROM bridge_pairings WHERE project_id=$1 AND ($2::uuid IS NULL OR agent_a=$2 OR agent_b=$2)',[id,scope]);
      }
      await audit(client,actor,input.enabled?'pairing.bulk.enable':'pairing.bulk.disable',scope??id);
      const pairings=await client.query('SELECT agent_a,agent_b,environment_id FROM bridge_pairings WHERE project_id=$1',[id]);
      return {saved:true,pairings:pairings.rows,links_in_scope:scope?Math.max(0,agents.rowCount!-1):agents.rowCount!*(agents.rowCount!-1)/2};
    }
    if(path.length===3 && path[2]==='pairings') {
      const input=z.strictObject({agent_a:uuid,agent_b:uuid,enabled:z.boolean().default(true)}).parse(body);
      const [a,b]=[input.agent_a,input.agent_b].sort();
      if(a===b) fail(422,'INVALID_PAIRING','Select two different agents.');
      const agents=await client.query('SELECT id,environment_id,role FROM bridge_agents WHERE project_id=$1 AND id=ANY($2::uuid[])',[id,[a,b]]);
      if(agents.rowCount!==2) inaccessible();
      if(input.enabled) {
        await client.query('DELETE FROM bridge_pairing_blocks WHERE agent_a=$1 AND agent_b=$2',[a,b]);
        await client.query('INSERT INTO bridge_pairings(project_id,environment_id,agent_a,agent_b) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,agents.rows[0].environment_id,a,b]);
      } else {
        await client.query('INSERT INTO bridge_pairing_blocks(project_id,agent_a,agent_b) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,a,b]);
        await client.query('DELETE FROM bridge_pairings WHERE agent_a=$1 AND agent_b=$2',[a,b]);
      }
      await audit(client,actor,input.enabled?'pairing.enable':'pairing.disable',a);return {paired:input.enabled};
    }
    if(path[2]==='agents' && path.length===5) {
      const agentId=uuid.parse(path[3]);
      const found=await client.query('SELECT id FROM bridge_agents WHERE id=$1 AND project_id=$2',[agentId,id]);
      if(!found.rowCount) inaccessible();
      if(path[4]==='revoke-access') {
        z.strictObject({confirm:z.literal(true)}).parse(body);
        await client.query('UPDATE bridge_credentials SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL',[agentId]);
        await audit(client,actor,'agent.access.revoke',agentId);
        return {revoked:true};
      }
      if(path[4]==='name') {
        const input=z.strictObject({name:label}).parse(body);
        await client.query('UPDATE bridge_agents SET name=$2,instructions_revision=instructions_revision+1 WHERE id=$1',[agentId,input.name]);
        await audit(client,actor,'agent.rename',agentId);return {id:agentId,name:input.name};
      }
      if(path[4]==='credentials') {
        if((await client.query('SELECT key_bound FROM bridge_agents WHERE id=$1',[agentId])).rows[0].key_bound)fail(409,'KEY_BOUND_AGENT','Generate replacement setup for this key-bound agent.');
        const input=z.strictObject({expires_days:z.number().int().min(1).max(90).default(30),rotate:z.boolean().default(false),overlap_seconds:z.number().int().min(0).max(3600).default(0)}).parse(body);
        if(input.rotate) await client.query(`UPDATE bridge_credentials SET expires_at=LEAST(expires_at,now()+$2*interval '1 second'),
          revoked_at=CASE WHEN $2=0 THEN now() ELSE revoked_at END WHERE agent_id=$1 AND revoked_at IS NULL`,[agentId,input.overlap_seconds]);
        const credential=newCredential();
        const expires=new Date(Date.now()+input.expires_days*86400000);
        await client.query('INSERT INTO bridge_credentials(id,agent_id,digest,expires_at) VALUES($1,$2,$3,$4)',[credential.id,agentId,credential.digest,expires]);
        await audit(client,actor,input.rotate?'credential.rotate':'credential.issue',credential.id);
        return {id:credential.id,token:credential.token,expires_at:expires,shown_once:true};
      }
      if(path[4]==='takeover') {
        z.strictObject({confirm:z.literal(true)}).parse(body);
        const grant=randomBytes(32).toString('base64url');
        await client.query('UPDATE bridge_agents SET session_id=NULL,generation=generation+1,takeover_digest=$2 WHERE id=$1',[agentId,digest(grant)]);
        await client.query("UPDATE bridge_tasks SET state='needs_reconciliation',updated_at=now() WHERE assignee_id=$1 AND state IN ('claimed','cancel_requested')",[agentId]);
        await audit(client,actor,'session.takeover',agentId);return {authorized:true,takeover_token:grant,shown_once:true,instruction:'Provision this single-use grant privately to the replacement. Reconcile unfinished local work.'};
      }
      if(path[4]==='recipient-key') {
        const input=z.strictObject({scheme:z.literal('age'),public_key:z.string().regex(/^age1[0-9a-z]{58}$/)}).parse(body);
        const fingerprint=digest(input.public_key);
        await client.query(`INSERT INTO bridge_recipient_keys(agent_id,scheme,public_key,fingerprint) VALUES($1,$2,$3,$4)
          ON CONFLICT(agent_id) DO UPDATE SET scheme=EXCLUDED.scheme,public_key=EXCLUDED.public_key,fingerprint=EXCLUDED.fingerprint,updated_at=now()`,[agentId,input.scheme,input.public_key,fingerprint]);
        await audit(client,actor,'recipient-key.assign',agentId);return {scheme:input.scheme,public_key:input.public_key,fingerprint};
      }
      if(path[4]==='state') {
        const input=z.strictObject({active:z.boolean()}).parse(body);
        await client.query('UPDATE bridge_agents SET active=$2 WHERE id=$1',[agentId,input.active]);
        await audit(client,actor,input.active?'agent.enable':'agent.disable',agentId);return input;
      }
    }
    if(path[2]==='credentials' && path.length===5 && path[4]==='revoke') {
      z.strictObject({}).parse(body);
      const credentialId=uuid.parse(path[3]);
      const found=await client.query(`UPDATE bridge_credentials k SET revoked_at=COALESCE(revoked_at,now()) FROM bridge_agents a
        WHERE k.agent_id=a.id AND a.project_id=$1 AND k.id=$2 RETURNING k.id`,[id,credentialId]);
      if(!found.rowCount) inaccessible();
      await audit(client,actor,'credential.revoke',credentialId);return {revoked:true};
    }
    inaccessible();
  });
}

async function ownerMessage(client:Transaction,owner:Owner,convo:Record<string,any>,recipient:string,type:string,body:string,taskId?:string) {
  const sequence=await client.query('UPDATE bridge_conversations SET next_sequence=next_sequence+1 WHERE id=$1 RETURNING next_sequence-1 AS sequence',[convo.id]);
  const result=await client.query(`INSERT INTO bridge_messages(id,project_id,environment_id,conversation_id,sequence,sender_id,author_type,recipient_agent_id,type,body,task_id)
    VALUES($1,$2,$3,$4,$5,NULL,'owner',$6,$7,$8,$9) RETURNING *`,[randomUUID(),convo.project_id,convo.environment_id,convo.id,sequence.rows[0].sequence,recipient,type,body,taskId??null]);
  return {...result.rows[0],owner_id:owner.id};
}
