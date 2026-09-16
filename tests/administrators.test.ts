import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {hashPassword,verifyPassword} from 'better-auth/crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {administratorOperation} from '../src/lib/administrator-service';
import {adminOperation,type Owner} from '../src/lib/admin-service';
import {provisionProject} from '../src/lib/project-kit';
import {createOwnerAuth} from '../src/lib/owner-auth';
import {createOwnerGuard} from '../src/lib/owner';
describe.skipIf(!process.env.TEST_DATABASE_URL)('administrator permissions',()=>{
 let db:Pool,project:string,other:string,member:Owner,memberId:string;
 const owner={id:randomUUID(),email:randomUUID()+'@example.test'},secret=randomBytes(24).toString('hex'),name='admin-'+randomUUID().slice(0,8),memberName='project-'+randomUUID().slice(0,8);
 beforeAll(async()=>{
  const url=new URL(process.env.TEST_DATABASE_URL!);if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test')throw Error('Isolated database required');db=new Pool({connectionString:url.toString()});
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Test administrator\',$2,true,now(),now())',[owner.id,owner.email]);
  await db.query('INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',[randomUUID(),owner.id,await hashPassword(secret)]);
  await db.query('INSERT INTO bridge_owner_state(owner_id) VALUES($1)',[owner.id]);await db.query('INSERT INTO bridge_administrators VALUES($1,$1,$2,\'platform\')',[owner.id,name]);
  project=(await adminOperation(db,owner,'POST',['projects'],{name:'Assigned',client_label:'Synthetic'}) as any).id;other=(await adminOperation(db,owner,'POST',['projects'],{name:'Unassigned',client_label:'Synthetic'}) as any).id;
 });
 afterAll(async()=>{const members=(await db.query('SELECT user_id FROM bridge_administrators WHERE workspace_owner_id=$1',[owner.id])).rows.map(r=>r.user_id);for(const id of [project,other])if(id)await adminOperation(db,owner,'POST',['projects',id,'delete'],{confirm_name:id===project?'Assigned':'Unassigned'});await db.query('DELETE FROM bridge_audit WHERE owner_id=$1',[owner.id]);await db.query('DELETE FROM bridge_administrators WHERE workspace_owner_id=$1',[owner.id]);await db.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[members]);await db.end();});
 it('creates project accounts that sign in and only see assigned projects',async()=>{
  const result:any=await administratorOperation(db,owner,'POST',['administrators'],{name:'Project operator',username:memberName,role:'project',projects:[project],password:secret,current_password:secret});memberId=result.id;member={id:owner.id,userId:memberId,email:'test@example.test'};
  const auth=createOwnerAuth(db,{secret:randomBytes(32).toString('hex'),baseURL:'http://127.0.0.1:3220'});
  const response=await auth.handler(new Request('http://127.0.0.1:3220/api/auth/sign-in/email',{method:'POST',headers:{origin:'http://127.0.0.1:3220','content-type':'application/json'},body:JSON.stringify({email:memberName,password:secret})}));expect(response.status).toBe(200);
  const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const guarded=await createOwnerGuard(auth,db)(new Request('http://127.0.0.1:3220/api/admin',{headers:{cookie}}));expect(guarded).toMatchObject({id:owner.id,userId:memberId,role:'project'});
  const list:any=await adminOperation(db,guarded,'GET',[],null);expect(list.projects.map((p:any)=>p.id)).toEqual([project]);expect(list.administrator.role).toBe('project');
  expect((await adminOperation(db,member,'GET',['projects',project],null) as any).project.id).toBe(project);
  await expect(adminOperation(db,member,'GET',['projects',other],null)).rejects.toThrow();
  await expect(adminOperation(db,member,'POST',['projects'],{name:'Blocked',client_label:'Synthetic'})).rejects.toMatchObject({code:'PLATFORM_REQUIRED'});
  await expect(administratorOperation(db,member,'GET',['administrators'],null)).rejects.toMatchObject({code:'PLATFORM_REQUIRED'});
  await expect(provisionProject(db,member,{name:'Blocked',client_label:'Synthetic',environments:[{name:'Env',agents:[{name:'Agent',prompt_template:'discovery'}]}]},randomUUID())).rejects.toMatchObject({code:'PLATFORM_REQUIRED'});
  const environment:any=await adminOperation(db,member,'POST',['projects',project,'environments'],{name:'Assigned environment',create_agent:false});expect(environment.id).toBeTruthy();
 });
 it('creates another platform administrator and rejects foreign project grants',async()=>{
  const result:any=await administratorOperation(db,owner,'POST',['administrators'],{name:'Second platform administrator',username:'platform-'+randomUUID().slice(0,8),role:'platform',projects:[],password:secret,current_password:secret});
  const platform={id:owner.id,userId:result.id,email:'platform@example.test'};
  expect((await adminOperation(db,platform,'GET',[],null) as any).projects).toHaveLength(2);
  expect((await administratorOperation(db,platform,'GET',['administrators'],null) as any).administrators).toHaveLength(3);
  await expect(administratorOperation(db,owner,'POST',['administrators'],{name:'Foreign grant',username:'foreign-'+randomUUID().slice(0,8),role:'project',projects:[randomUUID()],password:secret,current_password:secret})).rejects.toThrow();
 });
 it('protects workspace ownership and verifies passwords before changes',async()=>{
  const input={name:'Owner',username:name,role:'project',active:false,projects:[project],current_password:secret};
  await expect(administratorOperation(db,owner,'POST',['administrators',owner.id],input)).rejects.toMatchObject({code:'WORKSPACE_OWNER_REQUIRED'});
  await expect(administratorOperation(db,member,'POST',['account'],{name:'Operator',username:memberName,current_password:'wrong'})).rejects.toMatchObject({code:'PASSWORD_INCORRECT'});
 });
 it('allows own password changes and disables accounts immediately',async()=>{
  const changed=secret+'new';await administratorOperation(db,member,'POST',['account'],{name:'Operator',username:memberName,current_password:secret,new_password:changed});
  const hash=(await db.query('SELECT password FROM account WHERE "userId"=$1',[memberId])).rows[0].password;expect(await verifyPassword({hash,password:changed})).toBe(true);expect((await db.query('SELECT id FROM "session" WHERE "userId"=$1',[memberId])).rowCount).toBe(0);
  await administratorOperation(db,owner,'POST',['administrators',memberId],{name:'Operator',username:memberName,role:'project',active:false,projects:[project],current_password:secret});
  await expect(adminOperation(db,member,'GET',[],null)).rejects.toMatchObject({code:'OWNER_DISABLED'});
 });
});
