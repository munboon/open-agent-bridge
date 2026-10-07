import {z} from 'zod';
import type {Transaction} from './db';
import {audit,type AgentIdentity} from './agent-auth';
import {idempotent} from './messaging';

export const handoffInput=z.strictObject({
  purpose:z.string().trim().min(1).max(2000),
  revision:z.string().trim().min(1).max(120).optional(),
  next_action:z.string().trim().min(1).max(2000),
  acceptance_checks:z.array(z.string().trim().min(1).max(500)).max(20).optional(),
});
export type Handoff=z.infer<typeof handoffInput>;
export const outcomeInput=z.strictObject({
  status:z.enum(['accepted','validated','applied','completed','blocked','failed']),
  evidence:z.string().trim().min(1).max(4000),
});
export type PackageOutcome=z.infer<typeof outcomeInput>&{id:string;package_id:string;reporter_id:string;created_at:string};
export const activityInput=z.strictObject({
  state:z.enum(['working','waiting','blocked','completed','idle']),
  title:z.string().trim().min(1).max(240),
  summary:z.string().trim().min(1).max(2000),
  communication:z.enum(['native','bridge','mixed','other']).optional(),
});
export type ActivityReport=z.infer<typeof activityInput>&{reported_at:string;generation:number};
export async function reportActivity(client:Transaction,who:AgentIdentity,body:unknown,key:string|null){
  const data=activityInput.parse(body);
  return idempotent(client,who.id,'activity',key,data,async()=>{
    const report:ActivityReport={...data,reported_at:new Date().toISOString(),generation:who.generation};
    await client.query('UPDATE bridge_agents SET activity_report=$2 WHERE id=$1',[who.id,report]);
    await audit(client,who,'activity.report',who.id);
    return {activity:report};
  });
}
