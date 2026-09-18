import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import type {Transaction} from './db';
import type {AgentIdentity} from './agent-auth';
import {fail} from './protocol';

export const contactScheduleSchema=z.discriminatedUnion('mode',[
 z.strictObject({mode:z.literal('short_poll'),interval_seconds:z.number().int().min(1).max(60).default(5)}),
 z.strictObject({mode:z.literal('checkpoint')})
]);
export async function reportContact(client:Transaction,who:AgentIdentity,body:unknown){
 const input=contactScheduleSchema.parse(body);
 const existing=(await client.query('SELECT contact_state FROM bridge_agents WHERE id=$1',[who.id])).rows[0].contact_state;
 if(existing?.generation===who.generation&&Date.parse(existing.listening_until)>Date.now())fail(409,'LISTENER_ACTIVE','Stop the active listener before changing its schedule.');
 const state={...input,generation:who.generation,next_at:input.mode==='short_poll'?new Date(Date.now()+input.interval_seconds*1000).toISOString():null,listening_until:null};
 await client.query('UPDATE bridge_agents SET contact_state=$2 WHERE id=$1',[who.id,state]);
 return {reported:true};
}
export async function beginContact(client:Transaction,who:AgentIdentity,mode:'sse'|'websocket'|'long_poll'|null,seconds:number){
 if(!mode)return null; // A one-off GET must not imply scheduled polling.
 const lease=randomUUID();
 await client.query('UPDATE bridge_agents SET contact_state=$2 WHERE id=$1',[who.id,{generation:who.generation,mode,lease,next_at:null,listening_until:new Date(Date.now()+seconds*1000).toISOString()}]);
 return lease;
}
export async function finishContact(database:Pool,who:AgentIdentity,lease:string|null){
 if(lease)await database.query("UPDATE bridge_agents SET contact_state=contact_state || '{\"listening_until\":null}'::jsonb WHERE id=$1 AND generation=$2 AND contact_state->>'lease'=$3",[who.id,who.generation,lease]);
}
export async function recordShortPoll(client:Transaction,who:AgentIdentity){
 await client.query(`UPDATE bridge_agents SET contact_state=jsonb_set(contact_state,'{next_at}',to_jsonb(now()+((contact_state->>'interval_seconds')::int * interval '1 second')))
 WHERE id=$1 AND (contact_state->>'generation')::bigint=$2 AND contact_state->>'mode'='short_poll'`,[who.id,who.generation]);
}
