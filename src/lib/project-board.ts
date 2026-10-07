import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Transaction} from './db';
import {audit,digest} from './agent-auth';
import {idempotent} from './messaging';
import {boardCursor,readBoardCursor} from './board-cursor';
import {fail,inaccessible,messageBody,uuid} from './protocol';

export const boardPostInput=z.strictObject({body:messageBody,kind:z.enum(['update','finding','decision','blocker']).default('update'),parent_id:uuid.optional(),audience_agent_ids:z.array(uuid).min(1).max(100).optional()});
type Actor={id:string;owner_id:string;project_id:string;agent_id?:string};
type View={viewer:string|null;available:boolean;allowed:string[];scope:string};
export async function boardView(client:Transaction,project:string,viewer:string|null):Promise<View>{
  if(!viewer)return {viewer,available:true,allowed:[],scope:project+':owner'};
  const agent=(await client.query(`SELECT a.id,a.active AND p.state<>'archived' AND EXISTS(
    SELECT 1 FROM bridge_credentials k WHERE k.agent_id=a.id AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at>now()) AND (k.enrollment_expires_at IS NULL OR k.public_key IS NOT NULL)) AS available
    FROM bridge_agents a JOIN bridge_projects p ON p.id=a.project_id WHERE a.id=$1 AND a.project_id=$2`,[viewer,project])).rows[0];
  if(!agent)inaccessible();
  const pairs=await client.query(`SELECT CASE WHEN agent_a=$1 THEN agent_b ELSE agent_a END AS id
    FROM bridge_pairings WHERE project_id=$2 AND (agent_a=$1 OR agent_b=$1) ORDER BY id`,[viewer,project]);
  const allowed=[viewer,...pairs.rows.map(row=>row.id)].sort();
  return {viewer,available:agent.available,allowed,scope:project+':'+viewer+':'+digest(JSON.stringify(allowed))};
}
const visible=`($2::uuid IS NULL OR (p.required_agents <@ $3::uuid[] AND
  (p.audience_agent_ids IS NULL OR $2=ANY(p.audience_agent_ids))))`;
const fields=`p.*,COALESCE(a.name,u.name,'Former author') AS author_name,e.name AS environment_name`;
const joins=`LEFT JOIN bridge_agents a ON a.id=p.sender_id LEFT JOIN bridge_environments e ON e.id=a.environment_id
  LEFT JOIN "user" u ON u.id=p.owner_actor_id`;
function publicPost(row:Record<string,any>,view:View){
  const {sequence,required_agents,audience_agent_ids,owner_actor_id,...post}=row;
  return {...post,body:row.removed_at?'':row.body,...(!view.viewer?{required_agents,audience_agent_ids}:{})};
}
export async function boardPost(client:Transaction,project:string,id:string,view:View){
  if(!view.available)inaccessible();
  const row=(await client.query(`SELECT ${fields} FROM bridge_board_posts p ${joins}
    WHERE p.project_id=$1 AND ${visible} AND p.id=$4`,[project,view.viewer,view.allowed,id])).rows[0];
  if(!row)inaccessible();
  return row;
}
export async function boardHistory(client:Transaction,project:string,view:View,query:URLSearchParams){
  const direction=z.enum(['older','newer']).parse(query.get('direction')??'older');
  const limit=z.coerce.number().int().min(1).max(100).parse(query.get('limit')??50);
  const search=z.string().max(200).parse(query.get('q')??'');
  const author=z.union([uuid,z.literal('owner')]).nullable().parse(query.get('author'));
  const pinned=query.get('pinned')==='true';
  const scope=view.scope+':'+digest(JSON.stringify([search,author,pinned]));
  const cursor=query.get('cursor');
  const sequence=cursor?readBoardCursor(cursor,scope):direction==='older'?'9223372036854775807':'0';
  if(!view.available)return {posts:[],has_more:false,next_cursor:null,older_cursor:null,newer_cursor:null,retention_gap:false,view_available:false};
  const rows=await client.query(`SELECT ${fields} FROM bridge_board_posts p ${joins}
    WHERE p.project_id=$1 AND ${visible} AND p.sequence ${direction==='older'?'<':'>'} $4::bigint
    AND ($5='' OR (p.removed_at IS NULL AND strpos(lower(p.body),lower($5))>0))
    AND ($6::text IS NULL OR ($6='owner' AND p.author_type='owner') OR p.sender_id::text=$6)
    AND (NOT $7::boolean OR (p.pinned AND p.removed_at IS NULL))
    ORDER BY p.sequence ${direction==='older'?'DESC':'ASC'} LIMIT $8`,[project,view.viewer,view.allowed,sequence,search,author,pinned,limit+1]);
  const page=rows.rows.slice(0,limit);if(direction==='older')page.reverse();
  const first=page[0]?.sequence,last=page.at(-1)?.sequence;
  const board=(await client.query('SELECT retained_after FROM bridge_boards WHERE project_id=$1',[project])).rows[0];
  return {posts:page.map(row=>publicPost(row,view)),has_more:rows.rows.length>limit,
    next_cursor:page.length?boardCursor(direction==='older'?first:last,scope):cursor??boardCursor(sequence,scope),
    older_cursor:first?boardCursor(first,scope):cursor,newer_cursor:last?boardCursor(last,scope):cursor??boardCursor('0',scope),
    retention_gap:!!board&&BigInt(sequence)<=BigInt(board.retained_after)&&BigInt(board.retained_after)>0n,view_available:true};
}
export async function boardMetadata(client:Transaction,project:string,view:View,ownerActor?:string){
  const peers=await client.query(`SELECT a.id,a.name,a.active,e.name AS environment_name FROM bridge_agents a
    JOIN bridge_environments e ON e.id=a.environment_id WHERE a.project_id=$1
    AND ($2::uuid IS NULL OR a.id=ANY($3::uuid[])) ORDER BY a.name,a.id`,[project,view.viewer,view.allowed]);
  const unread=view.viewer&&view.available?(await client.query(`SELECT count(*) FROM bridge_board_posts p
    WHERE p.project_id=$1 AND ${visible} AND p.removed_at IS NULL AND p.sender_id IS DISTINCT FROM $2
    AND NOT EXISTS(SELECT 1 FROM bridge_board_reads r WHERE r.agent_id=$2 AND r.post_id=p.id)`,[project,view.viewer,view.allowed])).rows[0].count:0;
  const latest=view.viewer&&view.available?(await client.query(`SELECT p.id FROM bridge_board_posts p WHERE p.project_id=$1 AND ${visible} AND p.removed_at IS NULL AND p.sender_id IS DISTINCT FROM $2 AND NOT EXISTS(SELECT 1 FROM bridge_board_reads r WHERE r.agent_id=$2 AND r.post_id=p.id) ORDER BY p.sequence DESC LIMIT 1`,[project,view.viewer,view.allowed])).rows[0]?.id??null:null;
  const pins=await boardHistory(client,project,view,new URLSearchParams({pinned:'true',limit:'20'}));
  const ownerUnread=ownerActor&&!view.viewer?(await client.query(`SELECT count(*) FROM bridge_board_posts p WHERE p.project_id=$1 AND p.author_type='agent' AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM bridge_board_owner_reads r WHERE r.owner_actor_id=$2 AND r.post_id=p.id)`,[project,ownerActor])).rows[0].count:0;
  return {latest_unread_post_id:latest,pinned_posts:pins.posts,name:'Main message board',view_available:view.available,peers:view.available?peers.rows:[],unread_count:Number(view.viewer?unread:ownerUnread),
    history_policy:'current_pairings_include_retained_history',posting_is_task_authorization:false};
}
export async function publishBoardPost(client:Transaction,actor:Actor,input:unknown,key:string|null){
  const data=boardPostInput.parse(input),view=await boardView(client,actor.project_id,actor.agent_id??null);
  if(!view.available)inaccessible();
  // Validate the parent and requested audience before BOTH first commit and replay.
  const parent=data.parent_id?await boardPost(client,actor.project_id,data.parent_id,view):null;
  if(parent?.removed_at)fail(409,'BOARD_POST_REMOVED','Reply to an available post or start a new update.');
  if(data.audience_agent_ids){
    const targets=await client.query('SELECT id FROM bridge_agents WHERE project_id=$1 AND id=ANY($2::uuid[])',[actor.project_id,data.audience_agent_ids]);
    if(targets.rowCount!==new Set(data.audience_agent_ids).size||view.viewer&&data.audience_agent_ids.some(id=>!view.allowed.includes(id)))inaccessible();
  }
  let audience:string[]|null=parent?.audience_agent_ids??null;
  if(data.audience_agent_ids)audience=audience?audience.filter(id=>data.audience_agent_ids!.includes(id)):data.audience_agent_ids;
  if(audience&&view.viewer&&!audience.includes(view.viewer))fail(422,'BOARD_AUDIENCE','Include yourself in a restricted post audience.');
  if(audience?.length===0)fail(422,'BOARD_AUDIENCE','The reply has no permitted audience.');
  const result=await idempotent(client,actor.id,`board/${actor.project_id}/posts`,key,data,async()=>{
    await client.query('INSERT INTO bridge_boards(project_id) VALUES($1) ON CONFLICT DO NOTHING',[actor.project_id]);
    const seq=(await client.query('UPDATE bridge_boards SET next_sequence=next_sequence+1 WHERE project_id=$1 RETURNING next_sequence-1 AS sequence',[actor.project_id])).rows[0].sequence;
    const id=randomUUID(),required=[...new Set<string>([...(parent?.required_agents??[]),...(view.viewer?[view.viewer]:[])])];
    await client.query(`INSERT INTO bridge_board_posts(id,project_id,sequence,sender_id,author_type,owner_actor_id,parent_id,root_id,required_agents,audience_agent_ids,kind,body)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,actor.project_id,seq,view.viewer??null,view.viewer?'agent':'owner',view.viewer?null:actor.id,parent?.id??null,parent?.root_id??id,required,audience,data.kind,data.body]);
    await audit(client,actor,'board.post',id);return {id};
  });
  // Store only the resource ID in the replay cache. Moderation and revoked
  // parent permissions must never release a cached original body.
  return publicPost(await boardPost(client,actor.project_id,result.id,view),view);
}
export async function markBoardRead(client:Transaction,actor:Actor,input:unknown){
  const data=z.strictObject({post_ids:z.array(uuid).min(1).max(100)}).parse(input);
  const view=await boardView(client,actor.project_id,actor.agent_id??null);
  for(const id of new Set(data.post_ids)){
    await boardPost(client,actor.project_id,id,view);
    if(actor.agent_id)await client.query('INSERT INTO bridge_board_reads(agent_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.agent_id,id]);
    else await client.query('INSERT INTO bridge_board_owner_reads(owner_actor_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.id,id]);
  }
  return {read:data.post_ids};
}
export async function moderateBoard(client:Transaction,actor:Actor,id:string,action:string,input:unknown){
  if(actor.agent_id)inaccessible();
  await boardPost(client,actor.project_id,id,await boardView(client,actor.project_id,null));
  if(action==='pin'){
    const data=z.strictObject({pinned:z.boolean()}).parse(input);
    // A bounded pin list keeps startup context bounded.
    if(data.pinned&&(await client.query('SELECT count(*) FROM bridge_board_posts WHERE project_id=$1 AND pinned AND removed_at IS NULL AND id<>$2',[actor.project_id,id])).rows[0].count>=20)fail(409,'BOARD_PIN_LIMIT','Unpin an update before adding another. The board supports 20 pins.');
    await client.query('UPDATE bridge_board_posts SET pinned=$2 WHERE id=$1 AND removed_at IS NULL',[id,data.pinned]);
  }else if(action==='remove'){
    z.strictObject({confirm:z.literal(true)}).parse(input);
    await client.query("UPDATE bridge_board_posts SET body='',pinned=false,removed_at=COALESCE(removed_at,clock_timestamp()) WHERE id=$1",[id]);
  }else inaccessible();
  await audit(client,actor,'board.'+action,id);return {saved:true};
}
