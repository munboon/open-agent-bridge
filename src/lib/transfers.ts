import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Transaction } from './db';
import { audit, type AgentIdentity } from './agent-auth';
import { appendMessage, conversation, idempotent } from './messaging';
import { fail, inaccessible, messageBody, uuid } from './protocol';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const size=z.number().int().min(0).max(10*1024**3);
const filename=z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).refine(name=> !name.includes('..')&&!name.endsWith('.')&&!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name));
export const manifestSchema=z.strictObject({filename,size,sha256:hash,sensitivity:z.enum(['synthetic','internal','sensitive']),
  encryption:z.strictObject({scheme:z.literal('age'),recipient_fingerprint:hash}).optional(),
  parts:z.array(z.strictObject({index:z.number().int().min(0),offset:size,size:z.number().int().min(0).max(96*1024**2),sha256:hash})).min(1).max(1024),
}).superRefine((manifest,ctx)=> {
  let offset=0;
  for(const [index,part] of manifest.parts.entries()) {
    if(part.index!==index||part.offset!==offset||(part.size===0 && manifest.size!==0))ctx.addIssue({code:'custom',message:'Parts must cover the payload exactly.'});
    offset+=part.size;
  }
  if(offset!==manifest.size)ctx.addIssue({code:'custom',message:'Part size does not match payload size.'});
  if(manifest.size===0&&manifest.parts.length!==1)ctx.addIssue({code:'custom',message:'An empty payload requires exactly one empty part.'});
  if(manifest.sensitivity==='sensitive'&&!manifest.encryption)ctx.addIssue({code:'custom',message:'Sensitive payloads require recipient encryption.'});
});
export const transferInput=z.strictObject({conversation_id:uuid,direction:z.enum(['download','upload']),task_id:uuid.optional(),manifest:manifestSchema});
export const offerInput=z.strictObject({origin:z.url(),expires_at:z.iso.datetime(),token:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/)});
export const receiptInput=z.strictObject({offer_id:uuid,kind:z.enum(['uploaded','verified','failed']),measured_size:size,measured_sha256:hash,evidence:messageBody});
export const eventInput=z.strictObject({type:z.enum(['in_progress','failed','cancelled','cleanup_confirmed','cleanup_unknown']),offer_id:uuid.optional(),evidence:messageBody.refine(value=>Buffer.byteLength(value)<=65000,'Event evidence exceeds its notification budget.')})
  .refine(input=>input.type==='cancelled'||!!input.offer_id,{message:'This event requires its offer_id.'});
function envelopeKey():Buffer {
  const value=process.env.BRIDGE_ENVELOPE_KEY;
  if(!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))fail(503,'ENVELOPE_UNCONFIGURED','Transfer encryption is not configured.');
  const key=Buffer.from(value,'base64');
  if(key.length!==32)fail(503,'ENVELOPE_UNCONFIGURED','Transfer encryption is not configured.');
  return key;
}
function encrypt(token:string,binding:string) {
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',envelopeKey(),iv);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return {version:1,iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function decrypt(envelope:{version:number;iv:string;ciphertext:string;tag:string},binding:string) {
  if(envelope.version!==1)fail(503,'ENVELOPE_VERSION','Transfer secret version is unsupported.');
  const decipher=createDecipheriv('aes-256-gcm',envelopeKey(),Buffer.from(envelope.iv,'base64'));
  decipher.setAAD(Buffer.from(binding));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8');
}
async function getTransfer(client:Transaction,who:AgentIdentity,id:string) {
  const found=await client.query('SELECT * FROM bridge_transfers WHERE id=$1 AND project_id=$2 AND ($3=source_id OR $3=destination_id) FOR UPDATE',[id,who.project_id,who.id]);
  if(!found.rowCount)inaccessible();
  const transfer=found.rows[0];await conversation(client,who,transfer.conversation_id);
  await client.query('UPDATE bridge_offers SET envelope=NULL WHERE transfer_id=$1 AND (expires_at<=now() OR revoked_at IS NOT NULL)',[id]);
  if(transfer.state==='offered'||transfer.state==='in_progress') {
    const live=await client.query('SELECT id FROM bridge_offers WHERE transfer_id=$1 AND revoked_at IS NULL AND expires_at>now()',[id]);
    if(!live.rowCount) {await client.query("UPDATE bridge_transfers SET state='expired' WHERE id=$1",[id]);transfer.state='expired';}
  }
  return transfer;
}
async function notify(client:Transaction,who:AgentIdentity,transfer:Record<string,any>,type:string,body:string) {
  return appendMessage(client,who,{conversation_id:transfer.conversation_id,
    recipient_agent_id:who.id===transfer.source_id?transfer.destination_id:transfer.source_id,
    task_id:transfer.task_id??undefined,type,body,resource_id:transfer.id});
}
export async function transferOperation(client:Transaction,who:AgentIdentity,method:string,path:string[],body:unknown,key:string|null) {
  if(method==='POST' && path.length===1) {
    const input=transferInput.parse(body);
    if(who.project_state!=='active')fail(409,'PROJECT_PAUSED','New transfers are paused.');
    const convo=await conversation(client,who,input.conversation_id);
    const other=convo.agent_a===who.id?convo.agent_b:convo.agent_a;
    const agents=await client.query('SELECT id,role FROM bridge_agents WHERE id=ANY($1::uuid[])',[[who.id,other]]);
    const developer=agents.rows.find(a=>a.role==='development')?.id;
    const deployment=agents.rows.find(a=>a.role==='deployment')?.id;
    if(!developer||!deployment)fail(422,'TRANSFER_ROLES','Transfers need a development and deployment pair.');
    const source=input.direction==='download'?developer:deployment;
    const destination=input.direction==='download'?deployment:developer;
    if(input.manifest.encryption) {
      const trusted=await client.query('SELECT fingerprint FROM bridge_recipient_keys WHERE agent_id=$1',[destination]);
      if(trusted.rows[0]?.fingerprint!==input.manifest.encryption.recipient_fingerprint)fail(422,'RECIPIENT_KEY_MISMATCH','Use the owner-provisioned recipient encryption key.');
    }
    if(input.task_id) {
      const task=await client.query('SELECT id FROM bridge_tasks WHERE id=$1 AND conversation_id=$2',[input.task_id,convo.id]);
      if(!task.rowCount)inaccessible();
    }
    return idempotent(client,who.id,'transfers',key,input,async()=> {
      const result=await client.query(`INSERT INTO bridge_transfers(id,project_id,environment_id,conversation_id,source_id,destination_id,host_id,task_id,direction,manifest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[randomUUID(),who.project_id,convo.environment_id,convo.id,source,destination,developer,input.task_id??null,input.direction,input.manifest]);
      const transfer=result.rows[0];
      const notification=await notify(client,who,transfer,'note',`Transfer requested: ${input.manifest.filename}.`);
      return {transfer,notification};
    });
  }
  if(path.length<2)inaccessible();
  const id=uuid.parse(path[1]);const transfer=await getTransfer(client,who,id);
  if(method==='GET' && path.length===2) {
    const offers=await client.query('SELECT id,origin,expires_at,revoked_at,cleanup_state,created_at FROM bridge_offers WHERE transfer_id=$1 ORDER BY created_at DESC,id DESC',[id]);
    const receipts=await client.query('SELECT * FROM bridge_receipts WHERE transfer_id=$1 ORDER BY created_at',[id]);
    return {transfer,offers:offers.rows,receipts:receipts.rows};
  }
  if(method!=='POST')inaccessible();
  if(path.length===3&&path[2]==='offers') {
    const input=offerInput.parse(body);
    if(who.id!==transfer.host_id)fail(403,'HOST_REQUIRED','Only the assigned developer hosts transfer endpoints.');
    if(who.project_state!=='active')fail(409,'PROJECT_PAUSED','New offers are paused.');
    if(['verified','cancelled'].includes(transfer.state))fail(409,'TRANSFER_TERMINAL','This transfer no longer accepts offers.');
    const origin=new URL(input.origin);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail(422,'HTTPS_ORIGIN_REQUIRED','Supply an approved HTTPS origin without paths or credentials.');
    const expires=new Date(input.expires_at);
    if(expires.getTime()<=Date.now()||expires.getTime()>Date.now()+1800000)fail(422,'OFFER_EXPIRY','The offer must expire within 30 minutes and no later than the endpoint.');
    return idempotent(client,who.id,`transfers/${id}/offers`,key,input,async()=> {
      const offerId=randomUUID();const envelope=encrypt(input.token,`${id}:${offerId}`);
      await client.query('UPDATE bridge_offers SET revoked_at=COALESCE(revoked_at,now()),envelope=NULL WHERE transfer_id=$1',[id]);
      await client.query('INSERT INTO bridge_offers(id,transfer_id,origin,envelope,expires_at) VALUES($1,$2,$3,$4,$5)',[offerId,id,origin.origin,envelope,expires]);
      await client.query("UPDATE bridge_transfers SET state='offered',cleanup_state='pending',current_offer_id=$2 WHERE id=$1",[id,offerId]);
      const notification=await notify(client,who,transfer,'transfer_offer',`A ${transfer.direction} endpoint is available for ${transfer.manifest.filename}.`);
      await audit(client,who,'transfer.offer',offerId);
      return {offer:{id:offerId,transfer_id:id,origin:origin.origin,expires_at:expires,credential_reference:offerId},notification};
    });
  }
  if(path.length===5&&path[2]==='offers'&&path[4]==='credential') {
    z.strictObject({}).parse(body);const offerId=uuid.parse(path[3]);
    const found=await client.query('SELECT * FROM bridge_offers WHERE id=$1 AND transfer_id=$2',[offerId,id]);
    if(!found.rowCount)inaccessible();
    const offer=found.rows[0];
    if(!offer.envelope||offer.revoked_at||new Date(offer.expires_at).getTime()<=Date.now())fail(410,'OFFER_EXPIRED','This transfer credential is unavailable.');
    const token=decrypt(offer.envelope,`${id}:${offerId}`);
    await audit(client,who,'transfer.credential.read',offerId);
    return {token,expires_at:offer.expires_at,origin:offer.origin};
  }
  if(path.length===3&&path[2]==='receipts') {
    const input=receiptInput.parse(body);
    if(input.kind==='verified'&&who.id!==transfer.destination_id)fail(403,'RECEIVER_REQUIRED','Only the receiving agent can report final verification.');
    if(input.kind==='uploaded'&&(transfer.direction!=='upload'||who.id!==transfer.source_id))fail(403,'UPLOADER_REQUIRED','This receipt is not from the assigned uploader.');
    const offer=await client.query('SELECT id FROM bridge_offers WHERE id=$1 AND transfer_id=$2',[input.offer_id,id]);if(!offer.rowCount)inaccessible();
    return idempotent(client,who.id,`transfers/${id}/receipts`,key,input,async()=> {
      const current=input.offer_id===transfer.current_offer_id;
      if(current&&['verified','cancelled'].includes(transfer.state))fail(409,'TRANSFER_TERMINAL','This transfer already has a terminal outcome.');
      const matches=input.measured_size===transfer.manifest.size&&input.measured_sha256===transfer.manifest.sha256;
      const kind=matches?input.kind:'failed';
      const result=await client.query('INSERT INTO bridge_receipts(id,transfer_id,offer_id,reporter_id,kind,measured_size,measured_sha256,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [randomUUID(),id,input.offer_id,who.id,kind,input.measured_size,input.measured_sha256,input.evidence]);
      const state=kind==='verified'?'verified':kind==='uploaded'?'awaiting_verification':'failed';
      // Expiry stops credential delivery, not a receiver's late verification of
      // already delivered bytes. Superseded offers are evidence only.
      if(current)await client.query('UPDATE bridge_transfers SET state=$2 WHERE id=$1',[id,state]);
      if(state==='verified'||state==='failed')await client.query('UPDATE bridge_offers SET envelope=NULL,revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[input.offer_id]);
      const notification=await notify(client,who,transfer,'transfer_receipt',current?`Transfer ${state}; receiving evidence is an agent report.`:`Historical offer ${input.offer_id} reported ${state}; current transfer state is unchanged.`);
      await audit(client,who,current?`transfer.${state}`:'transfer.historical_receipt',input.offer_id);return {receipt:result.rows[0],applied_to_transfer:current,notification};
    });
  }
  if(path.length===3&&path[2]==='events') {
    const input=eventInput.parse(body);
    if(input.type.startsWith('cleanup_')&&who.id!==transfer.host_id)fail(403,'HOST_REQUIRED','The endpoint host reports cleanup.');
    if(input.offer_id) {
      const offer=await client.query('SELECT id FROM bridge_offers WHERE id=$1 AND transfer_id=$2',[input.offer_id,id]);if(!offer.rowCount)inaccessible();
    } else if(transfer.current_offer_id)fail(422,'OFFER_REQUIRED','Include the offer_id this cancellation concerns.');
    return idempotent(client,who.id,`transfers/${id}/events`,key,input,async()=> {
      const current=input.offer_id?input.offer_id===transfer.current_offer_id:!transfer.current_offer_id;
      if(input.type.startsWith('cleanup_')) {
        const cleanup=input.type==='cleanup_confirmed'?'confirmed':'unknown';
        await client.query('UPDATE bridge_offers SET cleanup_state=$2 WHERE id=$1',[input.offer_id,cleanup]);
        if(current)await client.query('UPDATE bridge_transfers SET cleanup_state=$2 WHERE id=$1',[id,cleanup]);
      } else if(current) {
        if(['verified','cancelled'].includes(transfer.state))fail(409,'TRANSFER_TERMINAL','A terminal transfer cannot be changed.');
        await client.query('UPDATE bridge_transfers SET state=$2 WHERE id=$1',[id,input.type]);
      }
      if(input.offer_id&&['failed','cancelled','cleanup_confirmed'].includes(input.type))await client.query('UPDATE bridge_offers SET envelope=NULL,revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[input.offer_id]);
      const notification=await notify(client,who,transfer,'note',`${current?'Current':'Historical'} offer ${input.offer_id??'none'}: ${input.type}. ${input.evidence}`);
      await audit(client,who,`transfer.${input.type}`,input.offer_id??id);return {recorded:true,applied_to_transfer:current,notification};
    });
  }
  inaccessible();
}
