import {randomUUID,randomBytes,generateKeyPairSync} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll,beforeEach,afterEach,afterAll,it,describe,expect} from 'vitest';
import {adminOperation} from '../src/lib/admin-service';
import {handleAgentRequest} from '../src/lib/agent-api';
import {signedHeaders} from '../scripts/bridge-client.mjs';
import {maintainOwners} from '../scripts/maintain';

describe.skipIf(!process.env.TEST_DATABASE_URL)('project board boundaries',()=>{
  let db:Pool,project:string,foreign:string;
  let a:any,b:any,c:any,d:any;
  const owner={id:randomUUID(),email:randomUUID()+'@example.test'},oldEnvelope=process.env.BRIDGE_ENVELOPE_KEY;
  const admin=(path:string[],body:unknown={},query?:URLSearchParams,key:string=randomUUID(),method='POST')=>adminOperation(db,owner,method,path,body,{key,query});
  const board=(suffix:string[]=[],body:unknown={},query?:URLSearchParams,key?:string,method='GET')=>admin(['projects',project,'board',...suffix],body,query,key,method) as Promise<any>;
  async function call(agent:any,path:string,body?:unknown,key=randomUUID()){
    const raw=body===undefined?'':JSON.stringify(body),method=body===undefined?'GET':'POST';
    const headers=agent.privateKey?signedHeaders({...agent,origin:'http://127.0.0.1'},method,'/api/v1/'+path,raw,key):{Authorization:'Bearer '+agent.token,'X-Bridge-Session':agent.session,'Content-Type':'application/json','Idempotency-Key':key};
    const response=await handleAgentRequest(new Request('http://127.0.0.1/api/v1/'+path,{method,headers,body:body===undefined?undefined:raw}),db);
    return {status:response.status,data:await response.json()};
  }
  async function identity(projectId:string,name:string){
    const env:any=await admin(['projects',projectId,'environments'],{name,create_agent:false});
    const agent:any=await admin(['projects',projectId,'agents'],{name,environment_id:env.id});
    const access:any=await admin(['projects',projectId,'agents',agent.id,'credentials'],{expires_days:null});
    const config={id:agent.id,token:access.token,session:'',credential:access.id};
    config.session=(await call(config,'sessions',{})).data.session_id;return config;
  }
  const pair=(x:any,y:any,enabled:boolean)=>admin(['projects',project,'pairings'],{agent_a:x.id,agent_b:y.id,enabled});
  const posts=async(agent:any,path='board/posts')=>(await call(agent,path)).data.posts as any[];
  beforeAll(async()=>{
    const url=new URL(process.env.TEST_DATABASE_URL!);if(url.hostname!=='127.0.0.1'||url.port!=='55442'||url.pathname!=='/oab_test')throw Error('Isolated test database required');
    db=new Pool({connectionString:url.toString()});process.env.BRIDGE_ENVELOPE_KEY=randomBytes(32).toString('base64');
    await db.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[owner.id,'Synthetic board owner',owner.email]);
    await db.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)',[owner.id]);
  });
  beforeEach(async()=>{
    project=(await admin(['projects'],{name:'Synthetic board',client_label:'Synthetic'}) as any).id;
    foreign=(await admin(['projects'],{name:'Other board',client_label:'Synthetic'}) as any).id;
    a=await identity(project,'Agent A');b=await identity(project,'Agent B');c=await identity(project,'Agent C');d=await identity(foreign,'Foreign agent');
    await pair(a,c,false);
  });
  afterEach(async()=>{for(const [id,name] of [[project,'Synthetic board'],[foreign,'Other board']])await admin(['projects',id,'delete'],{confirm_name:name});});
  afterAll(async()=>{await db.query('DELETE FROM bridge_idempotency WHERE actor_id=$1',[owner.id]);await db.query('DELETE FROM bridge_audit WHERE owner_id=$1',[owner.id]);await db.query('DELETE FROM bridge_owner_state WHERE owner_id=$1',[owner.id]);await db.query('DELETE FROM "user" WHERE id=$1',[owner.id]);await db.end();if(oldEnvelope===undefined)delete process.env.BRIDGE_ENVELOPE_KEY;else process.env.BRIDGE_ENVELOPE_KEY=oldEnvelope;});
  it('filters A-B-C roots, replies and reply ancestry before search or pagination',async()=>{
    const root=(await call(b,'board/posts',{body:'B root'})).data;
    const reply=(await call(a,'board/posts',{body:'A restricted secret',parent_id:root.id})).data;
    const nested=(await call(b,'board/posts',{body:'B response to A',parent_id:reply.id})).data;
    expect((await posts(c)).map(p=>p.id)).toEqual([root.id]);expect((await posts(a)).map(p=>p.id)).toEqual([root.id,reply.id,nested.id]);
    expect(await posts(c,'board/posts?q=secret')).toEqual([]);
    expect((await call(c,'board/posts/'+reply.id)).status).toBe(404);
    expect((await call(c,'board/posts',{body:'Unauthorized reply',parent_id:reply.id})).status).toBe(404);
    expect((await call(d,'board/posts/'+root.id)).status).toBe(404);
    const preview=await board(['posts'],{},new URLSearchParams({view_as:c.id}));expect(preview.posts.map((p:any)=>p.id)).toEqual([root.id]);
    expect(preview.posts[0]).not.toHaveProperty('sequence');expect(preview.posts[0]).not.toHaveProperty('required_agents');
  });
  it('unlocks retained posts on a grant, invalidates cursors, and hides them on removal',async()=>{
    const old=(await call(a,'board/posts',{body:'Retained A update'})).data;
    const first=(await call(c,'board/posts')).data;expect(first.posts).toEqual([]);
    await pair(a,c,true);
    expect((await call(c,'board/posts?cursor='+first.newer_cursor+'&direction=newer')).status).toBe(409);
    expect((await posts(c)).map(p=>p.id)).toEqual([old.id]);await pair(a,c,false);expect(await posts(c)).toEqual([]);
  });
  it('keeps disabled authors history while denying their own reads, including the preview',async()=>{
    const post=(await call(a,'board/posts',{body:'Earlier finding',kind:'finding'})).data;
    await admin(['projects',project,'agents',a.id,'state'],{active:false});
    expect((await call(a,'board/posts')).status).toBe(401);expect((await posts(b)).map(p=>p.id)).toEqual([post.id]);
    expect((await board(['posts'],{},new URLSearchParams({view_as:a.id}))).view_available).toBe(false);
  });
  it('restricts owner audiences and prevents replies or preview mutations from widening them',async()=>{
    const root=await board(['posts'],{body:'Owner restricted',audience_agent_ids:[a.id]},undefined,undefined,'POST');
    expect((await posts(a)).map(p=>p.id)).toEqual([root.id]);expect(await posts(b)).toEqual([]);
    const reply=(await call(a,'board/posts',{body:'A reply',parent_id:root.id})).data;
    expect(reply.id).toBeTruthy();expect(await posts(b)).toEqual([]);
    await expect(board(['posts'],{body:'Preview cannot post'},new URLSearchParams({view_as:a.id}),undefined,'POST')).rejects.toMatchObject({status:403});
    expect((await call(a,'board/posts',{body:'Cross-project audience',audience_agent_ids:[a.id,d.id]})).status).toBe(404);
  });
  it('keeps replay idempotent, rechecks parent access and returns current moderation state',async()=>{
    const key=randomUUID(),input={body:'Retry-safe'};
    const first=await call(a,'board/posts',input,key);expect(await call(a,'board/posts',input,key)).toEqual(first);
    expect((await call(a,'board/posts',{body:'Different'},key)).status).toBe(409);
    await board(['posts',first.data.id,'remove'],{confirm:true},undefined,undefined,'POST');
    expect((await call(a,'board/posts',input,key)).data.body).toBe('');
    const root=(await call(b,'board/posts',{body:'B parent'})).data,replyKey=randomUUID(),reply={body:'A child',parent_id:root.id};
    expect((await call(a,'board/posts',reply,replyKey)).status).toBe(200);await pair(a,b,false);
    expect((await call(a,'board/posts',reply,replyKey)).status).toBe(404);
  });
  it('counts only visible unread posts and makes owner previews side-effect free',async()=>{
    const aPost=(await call(a,'board/posts',{body:'A only'})).data,bPost=(await call(b,'board/posts',{body:'B visible'})).data;
    expect((await call(c,'board')).data.unread_count).toBe(1);
    await board(['posts'],{},new URLSearchParams({view_as:c.id}));expect((await db.query('SELECT count(*) FROM bridge_board_reads')).rows[0].count).toBe('0');
    expect((await call(c,'board/read',{post_ids:[aPost.id]})).status).toBe(404);
    expect((await call(c,'board/read',{post_ids:[bPost.id]})).status).toBe(200);expect((await call(c,'board')).data.unread_count).toBe(0);
  });
  it('tracks owner reading separately and refuses preview read markers',async()=>{
    const post=(await call(b,'board/posts',{body:'Owner unread'})).data;
    expect((await board()).unread_count).toBe(1);
    await expect(board(['read'],{post_ids:[post.id]},new URLSearchParams({view_as:a.id}),undefined,'POST')).rejects.toMatchObject({status:403});
    expect((await board()).unread_count).toBe(1);
    await board(['read'],{post_ids:[post.id]},undefined,undefined,'POST');expect((await board()).unread_count).toBe(0);
    expect((await call(a,'board')).data.unread_count).toBe(1);
  });
  it('bounds pages, supports offline catch-up, and binds opaque cursors to the view and filters',async()=>{
    await call(b,'board/posts',{body:'First'});const first=(await call(c,'board/posts?limit=1')).data;
    expect(first.newer_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    await Promise.all([call(b,'board/posts',{body:'Second'}),call(b,'board/posts',{body:'Third'})]);
    const next=(await call(c,'board/posts?direction=newer&limit=1&cursor='+first.newer_cursor)).data;
    expect(next.posts).toHaveLength(1);expect(next.has_more).toBe(true);
    const last=(await call(c,'board/posts?direction=newer&cursor='+next.next_cursor)).data;expect(last.posts).toHaveLength(1);
    expect((await call(a,'board/posts?cursor='+first.newer_cursor)).status).toBe(409);
    expect((await call(c,'board/posts?q=First&cursor='+first.newer_cursor)).status).toBe(409);
    expect((await call(c,'board/posts?cursor=bad')).status).toBe(422);
    const sequences=(await db.query('SELECT sequence FROM bridge_board_posts WHERE project_id=$1',[project])).rows.map(r=>r.sequence);expect(new Set(sequences).size).toBe(3);
  });
  it('uses normal credential, signed-proof, session and project authorization',async()=>{
    const keys=generateKeyPairSync('ed25519');a.privateKey=keys.privateKey.export({format:'pem',type:'pkcs8'});
    await db.query('UPDATE bridge_credentials SET public_key=$2 WHERE id=$1',[a.credential,keys.publicKey.export({format:'pem',type:'spki'})]);
    expect((await call(a,'board/posts',{body:'Signed'})).status).toBe(200);
    expect((await call({...a,privateKey:undefined},'board/posts')).status).toBe(401);
    expect((await call({...a,session:randomUUID()},'board/posts')).status).toBe(409);
    await admin(['projects',project,'credentials',a.credential,'revoke']);expect((await call(a,'board/posts')).status).toBe(401);
    await admin(['projects',project,'state'],{state:'archived'});expect((await call(b,'board/posts')).status).toBe(401);
    await expect(adminOperation(db,{id:randomUUID(),email:'other@example.test'},'GET',['projects',project,'board'],null)).rejects.toThrow();
  });
  it('retains pinned and recent reply context and retires removed post replay records',async()=>{
    const key=randomUUID(),old=(await call(b,'board/posts',{body:'Old tree'},key)).data;
    await call(a,'board/posts',{body:'Old reply',parent_id:old.id});
    const pinned=(await call(b,'board/posts',{body:'Pinned tree'})).data;await board(['posts',pinned.id,'pin'],{pinned:true},undefined,undefined,'POST');
    const active=(await call(b,'board/posts',{body:'Old but active tree'})).data;
    await db.query("UPDATE bridge_board_posts SET created_at=now()-interval '100 days' WHERE project_id=$1",[project]);
    await call(a,'board/posts',{body:'Recent reply',parent_id:active.id});
    const result=await maintainOwners(db,{ownerIds:[owner.id]});expect(result.board_posts_removed).toBe(2);
    expect((await posts(b)).map(p=>p.id)).toContain(pinned.id);expect((await posts(b)).map(p=>p.id)).toContain(active.id);
    expect((await call(b,'board/posts',{body:'Old tree'},key)).status).toBe(410);
    expect((await call(c,'board')).data.pinned_posts.map((p:any)=>p.id)).toEqual([pinned.id]);
  });
});
