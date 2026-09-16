import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,rename,unlink,lstat,realpath,statfs} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {z} from 'zod';
import type {Transaction} from './db';
import {audit,type AgentIdentity} from './agent-auth';
import {appendMessage,conversation,idempotent} from './messaging';
import {fail,inaccessible,uuid} from './protocol';
export const PACKAGE_CHUNK_BYTES=262144;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const input=z.strictObject({conversation_id:uuid,filename:z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).refine(v=>!v.includes('..')&&!v.endsWith('.')&&!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(v)),size:z.number().int().min(0).max(1024**3),sha256:hash,sensitivity:z.enum(['synthetic','internal','sensitive']),encryption:z.strictObject({scheme:z.literal('age'),recipient_fingerprint:hash}).optional()});
export async function packageRoot(){
 const configured=process.env.BRIDGE_PACKAGE_ROOT??(process.env.NODE_ENV==='production'?'/var/lib/oab/packages':'.local/packages');
 const root=resolve(/*turbopackIgnore: true*/ configured);await mkdir(root,{recursive:true,mode:0o700});
 if((await lstat(root)).isSymbolicLink()||await realpath(/*turbopackIgnore: true*/ root)!==root)fail(503,'PACKAGE_STORAGE','Package storage must be a real directory.');
 return root;
}
export const chunkName=(id:string,part:number,sha:string)=>`${id}-${part}-${sha}.part`;
export async function readChunk(id:string,part:number,sha:string){
 const handle=await open(join(await packageRoot(),chunkName(id,part,sha)),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>PACKAGE_CHUNK_BYTES)fail(503,'PACKAGE_STORAGE','Stored part is invalid.');return await handle.readFile();}finally{await handle.close();}
}
async function get(client:Transaction,who:AgentIdentity,id:string){
 const found=await client.query('SELECT * FROM bridge_packages WHERE id=$1 AND project_id=$2 AND ($3=sender_id OR $3=recipient_id) FOR UPDATE',[id,who.project_id,who.id]);
 if(!found.rowCount)inaccessible();const row=found.rows[0];await conversation(client,who,row.conversation_id);
 if(new Date(row.expires_at).getTime()<=Date.now()||row.state==='expired')fail(410,'PACKAGE_EXPIRED','This package has expired. Ask the sender to upload it again.');
 if(row.state==='cancelled')fail(410,'PACKAGE_CANCELLED','This package was cancelled.');return row;
}
export async function packageOperation(client:Transaction,who:AgentIdentity,method:string,path:string[],body:unknown,key:string|null){
 if(method==='POST'&&path.length===1){
  const data=input.parse(body);if(who.project_state!=='active')fail(409,'PROJECT_PAUSED','New packages are paused.');
  const convo=await conversation(client,who,data.conversation_id);const recipient=convo.agent_a===who.id?convo.agent_b:convo.agent_a;
  if(data.sensitivity==='sensitive'&&!data.encryption)fail(422,'ENCRYPTION_REQUIRED','Encrypt sensitive packages for the recipient before uploading.');
  if(data.encryption){const trusted=await client.query('SELECT fingerprint FROM bridge_recipient_keys WHERE agent_id=$1',[recipient]);if(trusted.rows[0]?.fingerprint!==data.encryption.recipient_fingerprint)fail(422,'RECIPIENT_KEY_MISMATCH','Use the recipient encryption key registered with the bridge.');}
  return idempotent(client,who.id,'packages',key,data,async()=>{
   // A global reservation prevents concurrent owners from oversubscribing disk.
   await client.query('SELECT pg_advisory_xact_lock(71349026)');
   const totals=(await client.query("SELECT COALESCE(sum(size),0) AS total,COALESCE(sum(size) FILTER(WHERE project_id=$1),0) AS project,count(*) FILTER(WHERE project_id=$1) AS count FROM bridge_packages WHERE purged_at IS NULL",[who.project_id])).rows[0];
   if(Number(totals.total)+data.size>2*1024**3||Number(totals.project)+data.size>2*1024**3||Number(totals.count)>=100)fail(409,'PACKAGE_QUOTA','Temporary package storage is full. Cancel unused packages or wait for expiry.');
   const row=(await client.query('INSERT INTO bridge_packages(id,project_id,conversation_id,sender_id,recipient_id,filename,size,sha256,sensitivity,encryption) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[randomUUID(),who.project_id,convo.id,who.id,recipient,data.filename,data.size,data.sha256,data.sensitivity,data.encryption??null])).rows[0];
   await audit(client,who,'package.create',row.id);return {...row,chunk_bytes:PACKAGE_CHUNK_BYTES};
  },async row=>{await get(client,who,row.id);});
 }
 if(path.length<2)inaccessible();const id=uuid.parse(path[1]);const row=await get(client,who,id);
 if(method==='GET'&&path.length===2)return {...row,chunk_bytes:PACKAGE_CHUNK_BYTES,parts:(await client.query('SELECT part,size,sha256 FROM bridge_package_chunks WHERE package_id=$1 ORDER BY part',[id])).rows};
 if(path.length===4&&path[2]==='parts'){
  const part=z.coerce.number().int().min(0).max(4095).parse(path[3]);
  if(method==='POST'){
   if(row.sender_id!==who.id)inaccessible();if(row.state!=='uploading')fail(409,'PACKAGE_STATE','The package is no longer accepting parts.');
   const data=z.strictObject({data:z.string().max(349528).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),sha256:hash}).parse(body);
   const bytes=Buffer.from(data.data,'base64');const expected=Math.min(PACKAGE_CHUNK_BYTES,Number(row.size)-part*PACKAGE_CHUNK_BYTES);
   if(expected<=0||bytes.length!==expected||createHash('sha256').update(bytes).digest('hex')!==data.sha256)fail(422,'PACKAGE_PART','Part size or hash does not match.');
   const existing=(await client.query('SELECT sha256 FROM bridge_package_chunks WHERE package_id=$1 AND part=$2',[id,part])).rows[0];
   if(existing){if(existing.sha256!==data.sha256)fail(409,'PACKAGE_PART_CONFLICT','This part already contains different bytes.');return {stored:true,part};}
   const root=await packageRoot();const free=await statfs(root);if(free.bavail*free.bsize<512*1024**2)fail(503,'PACKAGE_STORAGE_FULL','Package storage needs free space. Retry later.');const target=join(root,chunkName(id,part,data.sha256));const temp=join(root,randomUUID()+'.tmp');
   const file=await open(temp,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
   try{await rename(temp,target);}finally{await unlink(temp).catch(()=>{});}
   await client.query('INSERT INTO bridge_package_chunks(package_id,part,size,sha256) VALUES($1,$2,$3,$4)',[id,part,bytes.length,data.sha256]);return {stored:true,part};
  }
  if(method==='GET'){
   if(row.recipient_id!==who.id)inaccessible();if(row.state!=='ready')fail(410,'PACKAGE_CLOSED','Package downloads close after recipient verification.');
   const chunk=(await client.query('SELECT sha256 FROM bridge_package_chunks WHERE package_id=$1 AND part=$2',[id,part])).rows[0];if(!chunk)inaccessible();
   const bytes=await readChunk(id,part,chunk.sha256);if(createHash('sha256').update(bytes).digest('hex')!==chunk.sha256)fail(503,'PACKAGE_INTEGRITY','Stored part failed integrity verification.');
   return {part,sha256:chunk.sha256,data:bytes.toString('base64')};
  }
 }
 if(method==='POST'&&path.length===3&&path[2]==='complete'){
  z.strictObject({}).parse(body);if(row.sender_id!==who.id)inaccessible();if(row.state==='ready'||row.state==='verified')return row;
  const chunks=(await client.query('SELECT part,size,sha256 FROM bridge_package_chunks WHERE package_id=$1 ORDER BY part',[id])).rows;
  const sha=createHash('sha256');let size=0;for(const [i,chunk] of chunks.entries()){if(chunk.part!==i)fail(409,'PACKAGE_INCOMPLETE','Upload all parts before completing.');const bytes=await readChunk(id,i,chunk.sha256);size+=bytes.length;sha.update(bytes);}
  if(size!==Number(row.size))fail(409,'PACKAGE_INCOMPLETE','Upload all parts before completing.');
  if(sha.digest('hex')!==row.sha256)fail(422,'PACKAGE_INTEGRITY','The complete package hash does not match.');
  await client.query("UPDATE bridge_packages SET state='ready' WHERE id=$1",[id]);
  await appendMessage(client,who,{conversation_id:row.conversation_id,recipient_agent_id:row.recipient_id,type:'package_ready',body:`Package ready: ${row.filename}. Retrieve /api/v1/packages/${id}. Verify size ${row.size} and SHA-256 ${row.sha256} before use. Expires ${new Date(row.expires_at).toISOString()}.`,resource_id:id});
  await audit(client,who,'package.ready',id);return {...row,state:'ready'};
 }
 if(method==='POST'&&path.length===3&&path[2]==='receipt'){
  const data=z.strictObject({size:z.number().int().min(0),sha256:hash}).parse(body);if(row.recipient_id!==who.id)inaccessible();
  if(!['ready','verified'].includes(row.state))fail(409,'PACKAGE_NOT_READY','This package is not ready.');
  if(data.size!==Number(row.size)||data.sha256!==row.sha256)fail(422,'PACKAGE_INTEGRITY','The reported size or hash does not match.');
  if(row.state!=='verified'){await client.query("UPDATE bridge_packages SET state='verified',verified_at=now() WHERE id=$1",[id]);await audit(client,who,'package.verified',id);await appendMessage(client,who,{conversation_id:row.conversation_id,recipient_agent_id:row.sender_id,type:'package_verified',body:`Recipient verified ${row.filename}, package ${id}. This confirms file integrity, not deployment.`,resource_id:id});}
  return {verified:true};
 }
 if(method==='POST'&&path.length===3&&path[2]==='cancel'){
  z.strictObject({}).parse(body);if(row.sender_id!==who.id)inaccessible();await client.query("UPDATE bridge_packages SET state='cancelled' WHERE id=$1",[id]);await audit(client,who,'package.cancel',id);return {cancelled:true};
 }
 inaccessible();
}
