'use client';

import {AgentAvatar} from './AgentAvatar';
import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {browserRequestKey} from '../lib/browser-request-key';
import {chatThreads,threadMessages,participantTone,type ChatAgent,type ChatMessage,type ChatConversation} from '../lib/chat-threads';
import {Badge,EmptyState,Icon,Notice,api,problemText} from './ui';

interface HistoryPage {messages:ChatMessage[];has_more:boolean;next_sequence:number;retention_gap:{removed_through_sequence:number}|null}
interface Props {embedded?:boolean;selectionKey?:string;onSelect?:(key:string)=>void;initialRecipient?:string;projectId:string;agents:ChatAgent[];messages:ChatMessage[];conversations:ChatConversation[];onSent:()=>void}

export function ConversationPanel({embedded=false,selectionKey,onSelect,initialRecipient,projectId,agents,messages,conversations,onSent}:Props) {
  const threads=chatThreads(agents,conversations);
  const [selection,setSelection]=useState(initialRecipient?'owner:'+initialRecipient:'');
  const selected=threads.find(t=>t.key===(selectionKey??selection));
  const key=selected?.key??'', id=selected?.id??'';
  const active=useRef(key);active.current=key;
  const [search,setSearch]=useState('');
  const [findOpen,setFindOpen]=useState(false),[query,setQuery]=useState('');
  const [matchIndex,setMatchIndex]=useState(0);
  const scrollControl=useRef<HTMLInputElement>(null);
  const findInput=useRef<HTMLInputElement>(null);
  const findButton=useRef<HTMLButtonElement>(null);
  const messageElements=useRef(new Map<string,HTMLElement>());

  const [showConversation,setShowConversation]=useState(Boolean(initialRecipient));
  useEffect(()=>{if(selectionKey!==undefined){setSelection(selectionKey);setShowConversation(Boolean(selectionKey));}},[selectionKey]);
  const workspace=useRef<HTMLDivElement>(null);
  const backButton=useRef<HTMLButtonElement>(null);
  const listTrigger=useRef<HTMLButtonElement|null>(null);
  const listScroll=useRef(0);
  function openConversation(next:string,trigger?:HTMLButtonElement){
    if(trigger){listTrigger.current=trigger;listScroll.current=window.scrollY;}
    setSelection(next);onSelect?.(next);setShowConversation(true);
  }
  function backToConversations(){
    setShowConversation(false);setSelection('');onSelect?.('');
    requestAnimationFrame(()=>{listTrigger.current?.focus({preventScroll:true});window.scrollTo({top:listScroll.current,behavior:'instant'});});
  }
  useEffect(()=>{
    if(!embedded&&showConversation&&window.matchMedia('(max-width:700px)').matches){
      workspace.current?.scrollIntoView({block:'start',behavior:'instant'});
      backButton.current?.focus({preventScroll:true});
      if(follow.current&&viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;
    }
  },[showConversation,embedded]);
  useEffect(()=>{
    if(!showConversation)return;
    const update=()=>{
      const v=window.visualViewport;
      workspace.current?.style.setProperty('--chat-visible-height',`${v?.height??window.innerHeight}px`);
      workspace.current?.style.setProperty('--chat-visible-top',`${v?.offsetTop??0}px`);
    };
    update();window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
    return()=>{window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);};
  },[showConversation]);
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [history,setHistory]=useState<{id:string;messages:ChatMessage[]}>({id:'',messages:[]});
  const [cursor,setCursor]=useState(0),[hasMore,setHasMore]=useState(false);
  const [gap,setGap]=useState<number|null>(null);
  const [loading,setLoading]=useState(false),[sending,setSending]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const pending=useRef<{signature:string;key:string}|null>(null);
  const generation=useRef(0);
  const viewport=useRef<HTMLDivElement>(null), follow=useRef(true);
  const name=(agentId:string)=>agentId==='owner'?'You':agents.find(a=>a.id===agentId)?.name??'Former agent';
  useEffect(()=>{if(initialRecipient){setSelection('owner:'+initialRecipient);setShowConversation(true);}},[initialRecipient]);
  useEffect(()=>{
    const request=++generation.current;follow.current=true;
    setQuery('');setMatchIndex(0);setError('');setNotice('');setHistory({id,messages:[]});setGap(null);setHasMore(false);setLoading(Boolean(id));
    if(!id)return;
    api<HistoryPage>(`/api/admin/projects/${projectId}/conversations/${id}/messages?before_sequence=${Number.MAX_SAFE_INTEGER}`)
      .then(page=>{if(request!==generation.current)return;setHistory({id,messages:page.messages});setCursor(page.next_sequence);setHasMore(page.has_more);setGap(page.retention_gap?.removed_through_sequence??null);})
      .catch(e=>{if(request===generation.current)setError(problemText(e));})
      .finally(()=>{if(request===generation.current)setLoading(false);});
    return()=>{generation.current++;};
  },[id,key,projectId]);
  async function loadEarlier(){
    const request=generation.current;const oldHeight=viewport.current?.scrollHeight??0;follow.current=false;setLoading(true);
    try{
      const page=await api<HistoryPage>(`/api/admin/projects/${projectId}/conversations/${id}/messages?before_sequence=${cursor}`);
      if(request!==generation.current)return;
      setHistory(previous=>({id,messages:threadMessages(id,page.messages,previous.messages)}));setCursor(page.next_sequence);setHasMore(page.has_more);
      setGap(page.retention_gap?.removed_through_sequence??null);
      requestAnimationFrame(()=>{if(request===generation.current&&viewport.current)viewport.current.scrollTop+=viewport.current.scrollHeight-oldHeight;});
    }catch(e){if(request===generation.current)setError(problemText(e));}
    finally{if(request===generation.current)setLoading(false);}
  }
  async function send(event:FormEvent){
    event.preventDefault();if(sending||!selected?.owner||!drafts[key]?.trim())return;
    const sentKey=key;setSending(true);setError('');setNotice('');
    const payload={recipient_agent_id:selected.b,body:drafts[key]};
    const signature=JSON.stringify(payload);
    if(pending.current?.signature!==signature)pending.current={signature,key:browserRequestKey()};
    try{
      const message=await api<ChatMessage>(`/api/admin/projects/${projectId}/messages`,payload,pending.current.key);
      pending.current=null;setDrafts(previous=>({...previous,[sentKey]:''}));
      if(active.current===sentKey){setHistory(previous=>({id:message.conversation_id,messages:threadMessages(message.conversation_id,previous.messages,[message])}));setNotice('Message sent.');follow.current=true;}
      onSent();
    }catch(e){if(active.current===sentKey)setError(problemText(e));}
    finally{setSending(false);}
  }
  const displayed=id?threadMessages(id,history.id===id?history.messages:[],messages):[];
  const needle=query.trim().toLocaleLowerCase();
  const matches=needle?displayed.filter(message=>message.body.toLocaleLowerCase().includes(needle)):[];
  const matchedId=matches[Math.min(matchIndex,Math.max(0,matches.length-1))]?.id;
  function revealMessage(messageId:string){
    const element=messageElements.current.get(messageId),v=viewport.current;
    if(element&&v){follow.current=false;v.scrollTop+=element.getBoundingClientRect().top-v.getBoundingClientRect().top-v.clientHeight/3;}
  }
  function moveMatch(direction:number){
    if(!matches.length)return;
    const index=(matchIndex+direction+matches.length)%matches.length;
    setMatchIndex(index);revealMessage(matches[index].id);
  }
  function highlighted(body:string):ReactNode{
    if(!needle)return body;
    const parts:ReactNode[]=[];const lower=body.toLocaleLowerCase();let start=0,index=lower.indexOf(needle);
    while(index!==-1){parts.push(body.slice(start,index),<mark key={index}>{body.slice(index,index+needle.length)}</mark>);start=index+needle.length;index=lower.indexOf(needle,start);}
    parts.push(body.slice(start));return parts;
  }
  function syncScroll(){
    const v=viewport.current,control=scrollControl.current;if(!v||!control)return;
    const extent=v.scrollHeight-v.clientHeight;
    control.disabled=extent<=1;control.value=String(extent>0?Math.round(v.scrollTop/extent*1000):0);
  }
  useEffect(()=>{if(matchedId)revealMessage(matchedId);},[matchedId,query]);
  useEffect(()=>{if(findOpen)findInput.current?.focus({preventScroll:true});},[findOpen]);
  useEffect(()=>{
    const v=viewport.current;if(!v)return;
    const observer=new ResizeObserver(syncScroll);observer.observe(v);
    const messages=v.querySelector('.chat-messages');if(messages)observer.observe(messages);
    syncScroll();return()=>observer.disconnect();
  },[key,loading,displayed.length,showConversation,findOpen]);
  const lastMessage=displayed.at(-1)?.id;
  useEffect(()=>{if(!loading&&follow.current&&viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;},[lastMessage,key,loading]);
  const filtered=threads.filter(t=>t.title.toLowerCase().includes(search.toLowerCase()));
  const avatar=(agentId:string)=><span className={'chat-avatar chat-tone-'+participantTone(agentId,agents)} aria-hidden="true">{agentId==='owner'?<span>Y</span>:<AgentAvatar appearance={agents.find(a=>a.id===agentId)?.appearance}/>}</span>;
  return <section className="content-section conversations-section">
    <div className="section-heading"><div><h2 className="section-title"><Icon name="messages"/>Conversations</h2><p>Separate threads for your messages and agent-to-agent communication.</p></div></div>
    <div className={"chat-workspace"+(showConversation?" is-conversation-open":"")} ref={workspace}>
      <nav className="chat-sidebar" aria-label="Project conversations">
        <label className="chat-search"><span className="sr-only">Search conversations</span><Icon name="search"/><input type="search" placeholder="Search conversations" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        {[true,false].map(owner=><div className="chat-group" key={String(owner)}><h3>{owner?'Your chats':'Agent conversations'}</h3>
          {filtered.filter(t=>t.owner===owner).map(t=>{
            const latest=messages.filter(m=>m.conversation_id===t.id).sort((a,b)=>Number(b.sequence)-Number(a.sequence))[0];
            return <button type="button" className={'chat-thread'+(key===t.key?' is-selected':'')} aria-current={key===t.key?'page':undefined} key={t.key} onClick={event=>openConversation(t.key,event.currentTarget)} disabled={sending}>
              {avatar(t.owner?t.b:t.a)}<span><strong>{t.title}</strong><small>{latest?.body??(t.owner?'Start a conversation':'No messages yet')}</small></span>
            </button>;
          })}
          {!filtered.some(t=>t.owner===owner)&&<p className="chat-list-empty">{search?'No matching conversations.':owner?'Add an agent to start chatting.':'Agent conversations appear when agents communicate.'}</p>}
        </div>)}
      </nav>
      {selected?<div className="chat-pane">
        <header className="chat-header"><button type="button" className="button button-text chat-back" ref={backButton} onClick={backToConversations}><Icon name="back"/><span>All conversations</span></button><div className="chat-participants">{avatar(selected.a)}{avatar(selected.b)}<div><h3>{selected.title}</h3><p>{selected.owner?'Direct conversation with you':'Agent-to-agent conversation · View only'}</p></div></div>
          <button type="button" className="icon-button chat-find-toggle" ref={findButton} aria-label="Search this conversation" aria-expanded={findOpen} onClick={()=>{setFindOpen(!findOpen);if(findOpen)setQuery('');}}><Icon name="search"/></button>
          {!selected.owner&&<details className="chat-owner-menu"><summary className="icon-button" aria-label="Conversation actions"><Icon name="settings"/></summary><div className="chat-owner-links">{[selected.a,selected.b].map(agentId=><button className="button button-text" key={agentId} onClick={()=>openConversation('owner:'+agentId)}>Message {name(agentId)}</button>)}</div></details>}
        </header>
        {findOpen&&<div className="chat-find">
          <label><span className="sr-only">Find keywords in loaded messages</span><input ref={findInput} type="search" value={query} placeholder="Find in conversation…" onChange={event=>{setQuery(event.target.value);setMatchIndex(0);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();moveMatch(event.shiftKey?-1:1);}if(event.key==='Escape'){setFindOpen(false);setQuery('');findButton.current?.focus();}}}/></label>
          <div className="chat-find-controls"><span role="status">{needle?matches.length?`${Math.min(matchIndex+1,matches.length)} of ${matches.length} matching messages`:'No matches in loaded messages':'Search loaded messages'}</span><button className="icon-button" aria-label="Previous match" disabled={!matches.length} onClick={()=>moveMatch(-1)}><Icon name="back"/></button><button className="icon-button" aria-label="Next match" disabled={!matches.length} onClick={()=>moveMatch(1)}><Icon name="arrow"/></button></div>
          {hasMore&&<button className="button button-text" disabled={loading} onClick={()=>void loadEarlier()}>{loading?'Loading…':'Load earlier messages to extend search'}</button>}
        </div>}
        <div className="chat-scroll-area">
        <div className="chat-history" tabIndex={0} role="region" ref={viewport} onScroll={e=>{const v=e.currentTarget;follow.current=v.scrollHeight-v.scrollTop-v.clientHeight<80;syncScroll();}} aria-label={selected.title+' messages'} aria-busy={loading}>
          {error&&<Notice error>{error}</Notice>}
          {hasMore&&<button className="button button-outline chat-earlier" disabled={loading} onClick={()=>void loadEarlier()}>{loading?'Loading…':'Load earlier messages'}</button>}
          {gap!==null&&!hasMore&&<Notice>Earlier messages through sequence {gap} were removed by retention.</Notice>}
          {loading&&!displayed.length?<p className="supporting">Loading conversation…</p>:!displayed.length?<EmptyState icon="messages" title="No messages yet">{selected.owner?'Send your first message below. The agent can collect it when it comes online.':'Messages between these agents will appear here.'}</EmptyState>:<div className="chat-messages">
            {displayed.map(message=>{
              const sender=message.author_type==='owner'?'owner':message.author_type==='agent'?message.sender_id??'system':'system';
              const isOwnerReply=selected.owner&&message.author_type==='agent';
              return <article className={'chat-message'+((selected.owner?sender==='owner':sender===selected.b)?' is-end':' is-start')} key={message.id} ref={element=>{if(element)messageElements.current.set(message.id,element);else messageElements.current.delete(message.id);}} data-search-match={matchedId===message.id||undefined}>
                <div className="chat-message-author">{avatar(sender)}<strong>{sender==='system'?'Bridge system':name(sender)}</strong><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>{new Date(message.created_at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></div>
                <div className={'chat-bubble chat-tone-'+participantTone(sender,agents)}>{highlighted(message.body)}</div>
                <div className="chat-receipt"><Badge>{message.type.replaceAll('_',' ')}</Badge>{isOwnerReply?<span>Stored for you</span>:<span className={'chat-ticks'+(message.acknowledged_at?' is-acknowledged':'')} role="img" aria-label={message.acknowledged_at?'Acknowledged by recipient':message.retrieved_at?'Retrieved by recipient':'Not yet retrieved by recipient'} title={message.acknowledged_at?'Acknowledged by recipient':message.retrieved_at?'Retrieved by recipient':'Not yet retrieved by recipient'}><Icon name="check"/>{(message.acknowledged_at||message.retrieved_at)&&<Icon name="check"/>}{message.acknowledged_at&&<span className="chat-ack-label" aria-hidden="true">Acknowledged</span>}</span>}</div>
              </article>;
            })}
          </div>}
        </div>
        <div className="chat-scroll-rail"><input ref={scrollControl} type="range" min="0" max="1000" step="1" defaultValue="1000" aria-label="Conversation scroll position" aria-orientation="vertical" title="Drag to move through loaded messages" onChange={event=>{const v=viewport.current;if(v){v.scrollTop=Number(event.target.value)/1000*(v.scrollHeight-v.clientHeight);follow.current=v.scrollHeight-v.scrollTop-v.clientHeight<80;}}}/></div>
        </div>
        {selected.owner&&<form className="chat-composer" onSubmit={send}>
          <span className="sr-only" role="status">{notice}</span>
          <label htmlFor="owner-chat-body">Message {name(selected.b)} as yourself</label>
          <textarea id="owner-chat-body" value={drafts[key]??''} onChange={e=>setDrafts(previous=>({...previous,[key]:e.target.value}))} onKeyDown={event=>{
            if(event.key!=='Enter'||event.nativeEvent.isComposing||event.keyCode===229)return;
            event.preventDefault();
            if(event.altKey){const field=event.currentTarget,start=field.selectionStart,end=field.selectionEnd;const value=field.value.slice(0,start)+'\n'+field.value.slice(end);if(value.length<=16000){setDrafts(previous=>({...previous,[key]:value}));requestAnimationFrame(()=>field.setSelectionRange(start+1,start+1));}}
            else if(!event.repeat)event.currentTarget.form?.requestSubmit();
          }} aria-describedby="chat-send-help" required maxLength={16000} rows={2} disabled={sending} placeholder="Write a message…"/>
          <div><p id="chat-send-help">Enter to send · Alt+Enter for a new line</p><button className="button button-primary" disabled={sending||!drafts[key]?.trim()}>{sending?'Sending…':'Send message'}<Icon name="arrow"/></button></div>
        </form>}
      </div>:<EmptyState icon="messages" title="No conversations yet">Add an agent to start a conversation.</EmptyState>}
    </div>
  </section>;
}
