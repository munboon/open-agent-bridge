'use client';
import {useMemo,useSyncExternalStore} from 'react';
import type {AgentStatus} from '../lib/agent-status';
import {contactModes,lastContact,nextContact} from '../lib/agent-contact-labels';

// All visible agents share one clock. It does not make additional API requests.
let clock=Date.now(),timer:ReturnType<typeof setInterval>|undefined;
const listeners=new Set<()=>void>();
function subscribe(listener:()=>void){listeners.add(listener);if(!timer)timer=setInterval(()=>{clock=Date.now();listeners.forEach(fn=>fn());},1000);return()=>{listeners.delete(listener);if(!listeners.size){clearInterval(timer);timer=undefined;}};}
const getClock=()=>clock,getServerClock=()=>0;
export function AgentContact({status,stale=false}:{status?:AgentStatus;stale?:boolean}){
 const tick=useSyncExternalStore(subscribe,getClock,getServerClock);
 const anchor=useMemo(()=>({received:Date.now(),server:Date.parse(status?.sampled_at??'')}),[status?.sampled_at]);
 const now=Number.isFinite(anchor.server)?anchor.server+Math.max(0,(tick||anchor.received)-anchor.received):Date.now();
 const next=nextContact(status,now,stale),mode=status?.contact?.mode;
 return <div className="contact-timing">
  <dl><div><dt>Last contact</dt><dd>{stale?'Unavailable':status?.last_seen_at?<time dateTime={status.last_seen_at} title={new Date(status.last_seen_at).toLocaleString()}>{lastContact(status.last_seen_at,now)}</time>:'Never'}</dd></div><div><dt>Next contact</dt><dd className={next==='Overdue'?'contact-overdue':undefined}>{next}</dd></div></dl>
  <details className="contact-details"><summary>Connection details</summary><p>{stale?'Connection updates unavailable.':mode?`${status?.connection==='connected'?'Mode':'Last used'}: ${contactModes[mode]}. ${mode==='short_poll'?`Checks every ${status?.contact?.interval_seconds??5} seconds.`:mode==='long_poll'?'Waits up to 20 seconds; messages return as soon as available.':mode==='checkpoint'?'The agent checks when its work permits.':'Listens for messages with automatic connection renewal.'}`:'The agent has not reported a connection mode.'} Next contact estimates retrieval, not when work will start.</p></details>
 </div>;
}
