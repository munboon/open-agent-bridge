import {promptTemplateSchema,workInstructionsSchema,requireCustomInstructions} from './agent-template-schema';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import { ownerTransaction, type Owner } from './admin-service';
import { audit } from './agent-auth';
import { prepareAgentAccess } from './kit-access';
import { label, inaccessible } from './protocol';
import {idempotent} from './messaging';
export const projectSetupSchema=z.strictObject({name:label,client_label:label,environments:z.array(z.strictObject({name:label.max(114),agents:z.array(z.strictObject({name:label,prompt_template:promptTemplateSchema.default('discovery'),work_instructions:workInstructionsSchema.nullable().optional()}).superRefine(requireCustomInstructions)).min(1).max(10)})).min(1).max(10)}).superRefine((input,ctx)=>{
 const names=input.environments.map(e=>e.name.toLocaleLowerCase());if(new Set(names).size!==names.length)ctx.addIssue({code:'custom',message:'Environment names must be unique.'});
 if(input.environments.reduce((n,e)=>n+e.agents.length,0)>50)ctx.addIssue({code:'custom',message:'Create at most 50 agents during initial setup.'});
 for(const env of input.environments)if(new Set(env.agents.map(a=>a.name.toLocaleLowerCase())).size!==env.agents.length)ctx.addIssue({code:'custom',message:'Agent names within an environment must be unique.'});
});
// Nothing is created until the owner submits their complete configuration.
export async function provisionProject(database:Pool,owner:Owner,body:unknown,key:string|null=null){
 const input=projectSetupSchema.parse(body);
 return ownerTransaction(database,owner,client=>idempotent(client,owner.id,'project.setup',key,input,async()=>{
  const projectId=randomUUID(),actor={id:owner.id,owner_id:owner.id,project_id:projectId};
  await client.query('INSERT INTO bridge_projects(id,owner_id,name,client_label) VALUES($1,$2,$3,$4)',[projectId,owner.id,input.name,input.client_label]);await audit(client,actor,'project.create',projectId);
  for(const environment of input.environments){
   const environmentId=randomUUID();await client.query('INSERT INTO bridge_environments(id,project_id,name) VALUES($1,$2,$3)',[environmentId,projectId,environment.name]);await audit(client,actor,'environment.create',environmentId);
   for(const agent of environment.agents){const agentId=randomUUID();await client.query('INSERT INTO bridge_agents(id,project_id,environment_id,name,role,prompt_template,work_instructions,active) VALUES($1,$2,$3,$4,$5,$6,$7,true)',[agentId,projectId,environmentId,agent.name,agent.prompt_template==='development'?'development':'deployment',agent.prompt_template,agent.work_instructions??null]);await audit(client,actor,'agent.create',agentId);await prepareAgentAccess(client,owner.id,projectId,agentId);}
  }
  return {projectId};
 },async result=>{if(!(await client.query('SELECT id FROM bridge_projects WHERE id=$1 AND owner_id=$2',[result.projectId,owner.id])).rowCount)inaccessible();}));
}
