'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {ChatAgent} from '../lib/chat-threads';
import {browserRequestKey} from '../lib/browser-request-key';
import {Badge,EmptyState,Icon,Notice,api,problemText} from './ui';
import {AgentAvatar} from './AgentAvatar';

type Post={id:string;sender_id:string|null;author_type:string;author_name:string;environment_name:string|null;parent_id:string|null;root_id:string;kind:string;body:string;pinned:boolean;removed_at:string|null;created_at:string;required_agents?:string[];audience_agent_ids?:string[]|null};
type Page={posts:Post[];has_more:boolean;next_cursor:string|null;view_available:boolean;retention_gap:boolean};
type Metadata={view_available:boolean;unread_count:number;pinned_posts:Post[];peers:{id:string;name:string;active:boolean}[]};
type Props={projectId:string;agents:ChatAgent[];pairings:{agent_a:string;agent_b:string}[];search:string;onBack:()=>void;onSent:()=>void;onUnreadCount:(count:number)=>void;onMessageAgent:(id:string)=>void};
export function MainBoardPanel({projectId,agents,pairings,search,onBack,onSent,onUnreadCount,onMessageAgent}:Props){
  const [persona,setPersona]=useState(''),[author,setAuthor]=useState(''),[query,setQuery]=useState(''),[pinned,setPinned]=useState(false);
  const [page,setPage]=useState<Page|null>(null),[meta,setMeta]=useState<Metadata|null>(null),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[reply,setReply]=useState<Post|null>(null);
  const [draft,setDraft]=useState(''),[kind,setKind]=useState('update'),[audience,setAudience]=useState<string[]>([]),[restricted,setRestricted]=useState(false);
  const [filtersExpanded,setFiltersExpanded]=useState(false),[composeOpen,setComposeOpen]=useState(false);
  const [notice,setNotice]=useState(''),[removing,setRemoving]=useState<string|null>(null);
  const pending=useRef<{signature:string;key:string}|null>(null),generation=useRef(0),composer=useRef<HTMLTextAreaElement>(null);
  const context=JSON.stringify([projectId,persona,author,query,search,pinned]),currentContext=useRef(context);currentContext.current=context;
  const loadedContext=useRef(''),readingEarlier=useRef(false);
  useEffect(()=>{readingEarlier.current=false;},[context,refresh]);
  const params=new URLSearchParams({limit:'50'});
  if(persona)params.set('view_as',persona);if(author)params.set('author',author);if(query||search)params.set('q',query||search);if(pinned)params.set('pinned','true');
  const endpoint=`/api/admin/projects/${projectId}/board`,historyUrl=endpoint+'/posts?'+params;
  const effective=loadedContext.current===context?page:null;
  useEffect(()=>{
    const version=++generation.current;let stopped=false;
    setPage(null);setMeta(null);setLoading(true);setError('');setReply(null);setRemoving(null);
    async function load(initial:boolean){
      if(!initial&&readingEarlier.current)return;
      try{
        const [next,info]=await Promise.all([api<Page>(historyUrl),api<Metadata>(endpoint+(persona?'?view_as='+persona:''))]);
        if(stopped||version!==generation.current)return;
        loadedContext.current=context;
        // Replacing the current page also removes posts hidden by permission changes.
        setPage(next);setMeta(info);if(!persona)onUnreadCount(info.unread_count);setError('');
      }catch(e){if(!stopped&&version===generation.current){setPage(null);setMeta(null);setError(problemText(e));}}
      finally{if(initial&&!stopped&&version===generation.current)setLoading(false);}
    }
    void load(true);const timer=setInterval(()=>void load(false),10000);
    return()=>{stopped=true;generation.current++;clearInterval(timer);};
  },[context,refresh]);
  async function earlier(){
    if(!effective?.next_cursor||loading)return;
    const version=generation.current;readingEarlier.current=true;setLoading(true);
    try{
      const next=await api<Page>(historyUrl+'&cursor='+encodeURIComponent(effective.next_cursor));
      if(version!==generation.current)return;
      setPage(old=>old?{...next,posts:[...new Map([...next.posts,...old.posts].map(p=>[p.id,p])).values()]}:next);
    }catch(e){if(version===generation.current){setError(problemText(e));setPage(null);}}
    finally{if(version===generation.current)setLoading(false);}
  }
  async function publish(event:FormEvent){
    event.preventDefault();if(persona||busy||!draft.trim())return;
    const payload={body:draft,kind,...(reply?{parent_id:reply.id}:{}),...(restricted?{audience_agent_ids:audience}:{})};
    const signature=JSON.stringify(payload);if(pending.current?.signature!==signature)pending.current={signature,key:browserRequestKey()};
    setBusy(true);setError('');setNotice('');
    try{
      await api<Post>(endpoint+'/posts',payload,pending.current.key);pending.current=null;setDraft('');setReply(null);setComposeOpen(false);setRestricted(false);setAudience([]);setNotice('Update posted.');setRefresh(n=>n+1);onSent();
    }catch(e){setError(problemText(e));}finally{setBusy(false);}
  }
  async function moderate(post:Post,action:'pin'|'remove'){
    if(persona||busy)return;setBusy(true);setError('');
    try{await api(endpoint+'/posts/'+post.id+'/'+action,action==='pin'?{pinned:!post.pinned}:{confirm:true});setRemoving(null);setReply(null);setRefresh(n=>n+1);onSent();}
    catch(e){setError(problemText(e));}finally{setBusy(false);}
  }
  async function markShownRead(){
    if(persona||busy||!effective?.posts.length)return;setBusy(true);setError('');
    try{for(let start=0;start<effective.posts.length;start+=100)await api(endpoint+'/read',{post_ids:effective.posts.slice(start,start+100).map(p=>p.id)});setRefresh(n=>n+1);onSent();}
    catch(e){setError(problemText(e));}finally{setBusy(false);}
  }
  const name=(id:string)=>agents.find(a=>a.id===id)?.name??'Former agent';
  const allowed=(id:string)=>new Set([id,...pairings.filter(p=>p.agent_a===id||p.agent_b===id).map(p=>p.agent_a===id?p.agent_b:p.agent_a)]);
  const prospective=agents.filter(a=>{
    const permitted=allowed(a.id);
    return (!restricted||audience.includes(a.id))&&(!reply?.audience_agent_ids||reply.audience_agent_ids.includes(a.id))&&(reply?.required_agents??[]).every(id=>permitted.has(id));
  });
  const authors=persona?meta?.peers??[]:agents;
  const visiblePosts=effective?.posts??[];
  return <div className="chat-pane board-pane" data-palette="blue-teal">
    <header className="chat-header board-header">
      <button type="button" className="button button-text chat-back" onClick={onBack}><Icon name="back"/><span>All conversations</span></button>
      <div><h3>Main message board</h3><p>Updates, findings, decisions and blockers across this project.</p></div>
      <label><span>View as agent</span><select value={persona} onChange={e=>{setPersona(e.target.value);setAuthor('');setNotice('');}} disabled={busy}><option value="">Owner view</option>{agents.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
    </header>
    {persona&&<div className="board-preview" role="status"><Icon name="agents"/><span>Viewing as {name(persona)}. Read-only preview.{meta?.view_available?' '+meta.unread_count+' unread updates.':''}</span><button className="button button-text" onClick={()=>{setPersona('');setAuthor('');}}>Return to Owner view</button></div>}
    <div className="board-filters">
      <label className="board-search"><span className="sr-only">Search board history</span><Icon name="search"/><input type="search" placeholder="Search board history" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}/></label>
      <button type="button" className="button button-text board-filter-toggle" aria-expanded={filtersExpanded} aria-controls="board-filter-controls" onClick={()=>setFiltersExpanded(old=>!old)}><Icon name="filter"/>Filters{author||pinned?' · active':''}</button>
      <div id="board-filter-controls" className={'board-filter-controls'+(filtersExpanded?' is-open':'')}>
        <label><span className="sr-only">Filter by author</span><select aria-label="Filter by author" value={author} onChange={e=>setAuthor(e.target.value)}><option value="">All authors</option><option value="owner">Owner updates</option>{authors.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="board-pin-filter"><input type="checkbox" checked={pinned} onChange={e=>setPinned(e.target.checked)}/>Pinned only{meta?.pinned_posts.length?' ('+meta.pinned_posts.length+')':''}</label>
        <button type="button" className="button button-text" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh latest</button>
        {!persona&&!!meta?.unread_count&&<button type="button" className="button button-text" disabled={busy||!effective?.posts.length} onClick={()=>void markShownRead()}>Mark shown updates read</button>}
      </div>
    </div>
    <div className="chat-history board-history" role="region" aria-label="Main message board posts" aria-busy={loading} tabIndex={0}>
      {error&&<Notice error>{error}<button className="button button-text" onClick={()=>setRefresh(n=>n+1)}>Retry</button></Notice>}
      {effective?.has_more&&<button className="button button-outline chat-earlier" disabled={loading} onClick={()=>void earlier()}>{loading?'Loading…':'Load earlier updates'}</button>}
      {effective?.retention_gap&&<Notice>Earlier updates were removed by retention.</Notice>}
      {effective&&!effective.view_available?<EmptyState icon="agents" title="This agent cannot currently access the board">Check its enabled state, credentials and project access. Its existing posts remain in Owner view.</EmptyState>:loading&&!visiblePosts.length?<p className="supporting">Loading board…</p>:!error&&!visiblePosts.length?<EmptyState icon="messages" title={query||search||author||pinned?'No matching updates':persona?'No updates visible to this agent':'No updates yet'}>{persona?'This preview follows the agent’s current permissions.':'Post the first project update below.'}</EmptyState>:null}
      <div className="chat-messages board-posts">{visiblePosts.map(post=>{
        const parent=visiblePosts.find(p=>p.id===post.parent_id);
        return <article className={'board-post'+(post.parent_id?' is-reply':'')} id={'board-post-'+post.id} key={post.id}>
          <div className="chat-message-author"><span className="chat-avatar chat-tone-owner" aria-hidden="true">{post.sender_id?<AgentAvatar appearance={agents.find(a=>a.id===post.sender_id)?.appearance}/>:<span>Y</span>}</span><strong>{post.author_name}</strong>{post.environment_name&&<span className="board-environment">{post.environment_name}</span>}<time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>{new Date(post.created_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></div>
          {post.parent_id&&<p className="board-reply-context">Reply to {parent?parent.author_name:'an earlier update'}{parent&&!parent.removed_at?': '+parent.body.slice(0,100):''}</p>}
          <div className="board-post-body">{post.removed_at?<span className="supporting">Post removed by the owner.</span>:post.body}</div>
          <div className="board-post-actions"><Badge>{post.kind}</Badge>{post.pinned&&<Badge>Pinned</Badge>}{!persona&&!post.removed_at&&<><button className="button button-text" disabled={busy} onClick={()=>{setReply(post);setComposeOpen(true);setRemoving(null);requestAnimationFrame(()=>composer.current?.focus());}}>Reply</button><button className="button button-text" disabled={busy} onClick={()=>void moderate(post,'pin')}>{post.pinned?'Unpin':'Pin'}</button><button className="button button-text" disabled={busy} onClick={()=>setRemoving(post.id)}>Remove</button>{post.sender_id&&<button className="button button-text" disabled={busy} onClick={()=>onMessageAgent(post.sender_id!)}>Message {post.author_name} directly</button>}</>}</div>
          {removing===post.id&&!persona&&<div className="board-remove-confirm"><p>Remove this post’s text? Its author, replies and audit record remain.</p><button className="button button-outline" disabled={busy} onClick={()=>setRemoving(null)}>Cancel</button><button className="button button-primary" disabled={busy} onClick={()=>void moderate(post,'remove')}>Remove post</button></div>}
        </article>;
      })}</div>
    </div>
    {!persona&&<div className="board-compose-toggle"><button type="button" className="button button-primary" aria-expanded={composeOpen} aria-controls="board-composer" onClick={()=>{setComposeOpen(old=>!old);requestAnimationFrame(()=>composer.current?.focus());}}>{composeOpen?'Back to board':draft?'Continue your draft':'Post an update'}<Icon name={composeOpen?'back':'plus'}/></button></div>}
    {!persona&&<form id="board-composer" className={'chat-composer board-composer'+(composeOpen?' is-expanded':'')} onSubmit={publish}>
      {reply&&<div className="board-composer-reply"><span>Replying to {reply.author_name}</span><button type="button" className="button button-text" disabled={busy} onClick={()=>setReply(null)}>Cancel reply</button></div>}
      <div className="board-composer-options"><label><span>Update type</span><select value={kind} onChange={e=>setKind(e.target.value)} disabled={busy}><option value="update">Update</option><option value="finding">Finding</option><option value="decision">Decision</option><option value="blocker">Blocker</option></select></label><label className="board-pin-filter"><input type="checkbox" checked={restricted} disabled={busy} onChange={e=>setRestricted(e.target.checked)}/>Choose audience</label></div>
      {restricted&&<fieldset className="board-audience"><legend>Agents who may read this post</legend>{agents.map(a=><label key={a.id}><input type="checkbox" checked={audience.includes(a.id)} disabled={busy} onChange={e=>setAudience(old=>e.target.checked?[...old,a.id]:old.filter(id=>id!==a.id))}/>{a.name}</label>)}</fieldset>}
      <p className="supporting board-audience-summary">Visible to the owner and {prospective.length===agents.length&&!restricted&&!reply?'all project agents':prospective.length?prospective.map(a=>a.name).join(', '):'no agents under this audience'}.</p>
      <label htmlFor="board-body">{reply?'Reply as yourself':'Post as yourself'}</label><textarea ref={composer} id="board-body" value={draft} onChange={e=>setDraft(e.target.value)} required maxLength={16000} rows={3} disabled={busy} placeholder="Share an update, finding, decision or blocker…"/>
      <div><p className="supporting">Use tasks to assign work.</p><button className="button button-primary" disabled={busy||!draft.trim()||restricted&&!audience.length}>{busy?'Posting…':reply?'Post reply':'Post update'}<Icon name="arrow"/></button></div>
      {notice&&<span role="status">{notice}</span>}
    </form>}
  </div>;
}
