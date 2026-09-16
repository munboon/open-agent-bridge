import {audit} from './agent-auth';
import {randomUUID} from 'node:crypto';
import {hashPassword,verifyPassword} from 'better-auth/crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {ownerTransaction,type Owner} from './admin-service';
import {fail,inaccessible} from './protocol';
const username=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/,'Use 3–64 lowercase letters, numbers, dots, underscores or hyphens.');
const password=z.string().min(16).max(128);
const fields={name:z.string().trim().min(1).max(120),username,role:z.enum(['platform','project']),projects:z.array(z.string().uuid()).max(1000)};
export async function administratorOperation(database:Pool,owner:Owner,method:string,path:string[],body:unknown){
 const userId=owner.userId??owner.id;
 if(method==='POST'){
  const rate=await database.query(`INSERT INTO bridge_admin_attempts(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET attempts=CASE WHEN bridge_admin_attempts.started_at<now()-interval '1 minute' THEN 1 ELSE bridge_admin_attempts.attempts+1 END,started_at=CASE WHEN bridge_admin_attempts.started_at<now()-interval '1 minute' THEN now() ELSE bridge_admin_attempts.started_at END RETURNING attempts`,[userId]);
  if(rate.rows[0].attempts>10)fail(429,'RATE_LIMITED','Wait a minute before trying another account change.');
 }
 return ownerTransaction(database,owner,async client=>{
  const own=path[0]==='account';
  if(!own&&owner.role!=='platform')fail(403,'PLATFORM_REQUIRED','Administrator management requires a platform administrator.');
  if(method==='GET'){
   if(path.length!==1)inaccessible();
   const rows=await client.query(`SELECT u.id,u.name,u.email,m.username,COALESCE(m.role,'platform') AS role,o.active,COALESCE(array_agg(ap.project_id) FILTER(WHERE ap.project_id IS NOT NULL),'{}') AS projects FROM "user" u JOIN bridge_owner_state o ON o.owner_id=u.id LEFT JOIN bridge_administrators m ON m.user_id=u.id LEFT JOIN bridge_administrator_projects ap ON ap.user_id=u.id WHERE ${own?'u.id=$1':'COALESCE(m.workspace_owner_id,u.id)=$1'} GROUP BY u.id,m.username,m.role,o.active ORDER BY u.name`,own?[userId]:[owner.id]);
   return own?{account:rows.rows[0]}:{administrators:rows.rows,workspace_owner_id:owner.id};
  }
  if(method!=='POST')inaccessible();
  const confirm=z.object({current_password:z.string().min(1).max(128)}).parse(body);
  const credential=(await client.query('SELECT password FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',[userId])).rows[0];
  if(!credential?.password||!await verifyPassword({hash:credential.password,password:confirm.current_password}))fail(403,'PASSWORD_INCORRECT','Your current password is incorrect.');
  if(own){
   if(path.length!==1)inaccessible();
   const input=z.strictObject({name:fields.name,username,current_password:z.string(),new_password:password.optional()}).parse(body);
   if((await client.query('SELECT 1 FROM bridge_administrators WHERE username=$1 AND user_id<>$2',[input.username,userId])).rowCount)fail(409,'USERNAME_TAKEN','This username is already in use.');
   await client.query('UPDATE "user" SET name=$2,"updatedAt"=now() WHERE id=$1',[userId,input.name]);
   await client.query(`INSERT INTO bridge_administrators(user_id,workspace_owner_id,username,role) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username`,[userId,owner.id,input.username,owner.role]);
   if(input.new_password){await client.query('UPDATE account SET password=$2,"updatedAt"=now() WHERE "userId"=$1 AND "providerId"=\'credential\'',[userId,await hashPassword(input.new_password)]);await client.query('DELETE FROM "session" WHERE "userId"=$1',[userId]);}
   await audit(client,{id:userId,owner_id:owner.id},'administrator.account.update',userId);
   return {saved:true,sign_in_required:!!input.new_password};
  }
  const create=path.length===1;
  if(!create&&path.length!==2)inaccessible();
  const input=z.strictObject({...fields,active:z.boolean().default(true),password:create?password:password.optional(),current_password:z.string()}).parse(body);
  const id=create?randomUUID():path[1];
  if(!create&&!(await client.query('SELECT 1 FROM bridge_administrators WHERE user_id=$1 AND workspace_owner_id=$2',[id,owner.id])).rowCount)inaccessible();
  if(id===owner.id&&(!input.active||input.role!=='platform'))fail(409,'WORKSPACE_OWNER_REQUIRED','The original workspace administrator must remain an active platform administrator.');
  if(id===userId&&(!input.active||input.role!=='platform'))fail(409,'SELF_ACCESS','Ask another platform administrator to change your own access.');
  if((await client.query('SELECT 1 FROM bridge_administrators WHERE username=$1 AND user_id<>$2',[input.username,id])).rowCount)fail(409,'USERNAME_TAKEN','This username is already in use.');
  const projects=[...new Set(input.projects)];
  if(input.role==='project'&&!projects.length)fail(422,'PROJECT_REQUIRED','Assign at least one project.');
  if(projects.length&&(await client.query('SELECT id FROM bridge_projects WHERE owner_id=$1 AND id=ANY($2::uuid[])',[owner.id,projects])).rowCount!==projects.length)inaccessible();
  if(create){await client.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[id,input.name,`${id}@bridge.invalid`]);await client.query('INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',[randomUUID(),id,await hashPassword(input.password!)]);await client.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,$2)',[id,input.active]);}
  else {await client.query('UPDATE "user" SET name=$2,"updatedAt"=now() WHERE id=$1',[id,input.name]);await client.query('UPDATE bridge_owner_state SET active=$2 WHERE owner_id=$1',[id,input.active]);if(input.password)await client.query('UPDATE account SET password=$2,"updatedAt"=now() WHERE "userId"=$1 AND "providerId"=\'credential\'',[id,await hashPassword(input.password)]);await client.query('DELETE FROM "session" WHERE "userId"=$1',[id]);}
  await client.query('INSERT INTO bridge_administrators(user_id,workspace_owner_id,username,role) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username,role=EXCLUDED.role',[id,owner.id,input.username,input.role]);
  await client.query('DELETE FROM bridge_administrator_projects WHERE user_id=$1',[id]);
  if(input.role==='project')for(const project of projects)await client.query('INSERT INTO bridge_administrator_projects(user_id,project_id) VALUES($1,$2)',[id,project]);
  await audit(client,{id:userId,owner_id:owner.id},create?'administrator.create':'administrator.update',id);
  return {saved:true,id,sign_in_required:!create&&id===userId};
 });
}
