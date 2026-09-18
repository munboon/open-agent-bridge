import type {AgentStatus} from './agent-status';
export const contactModes={websocket:'WebSocket',sse:'SSE',long_poll:'Long polling',short_poll:'Short polling',checkpoint:'Work checkpoints'};
export function nextContact(status:AgentStatus|undefined,now:number,stale=false){
 if(stale)return 'Unavailable';
 const contact=status?.contact;
 if(!status||status.connection!=='connected'||!status.last_seen_at||now-Date.parse(status.last_seen_at)>75000||!contact)return 'Unknown';
 if(contact.listening_until&&Date.parse(contact.listening_until)>now)return 'Listening now';
 if(contact.mode==='checkpoint')return 'After current work step';
 if(contact.mode==='short_poll'&&contact.next_at){const seconds=Math.ceil((Date.parse(contact.next_at)-now)/1000);if(!Number.isFinite(seconds))return 'Unknown';return seconds>0?`In about ${seconds}s`:'Overdue';}
 return 'Unknown';
}
export function lastContact(value:string|null|undefined,now:number){
 if(!value)return 'Never';const seconds=Math.max(0,Math.floor((now-Date.parse(value))/1000));
 if(!Number.isFinite(seconds))return 'Unavailable';
 if(seconds<60)return `${seconds}s ago`;
 if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;
 if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;
 return `${Math.floor(seconds/86400)}d ago`;
}
