export interface ChatAgent {appearance?:import('./agent-appearance').AgentAppearance|null;id:string;public_id?:string;name:string;role?:string}
export interface ChatConversation {id:string;public_id?:string;agent_a:string;agent_b:string;kind?:string}
export interface ChatMessage {
  id:string;sender_id:string|null;author_type:string;recipient_agent_id:string;
  conversation_id:string;sequence:string;type:string;body:string;created_at:string;acknowledged_at:string|null;retrieved_at?:string|null;
}
export function chatThreads(agents:ChatAgent[],conversations:ChatConversation[]) {
  const name=(id:string)=>agents.find(a=>a.id===id)?.name??'Former agent';
  const owners=new Map(agents.map(a=>[a.id,{key:'owner:'+a.id,id:'',a:'owner',b:a.id,title:'You / '+a.name,owner:true}]));
  for(const c of conversations)if(c.agent_a===c.agent_b)owners.set(c.agent_a,{key:'owner:'+c.agent_a,id:c.id,a:'owner',b:c.agent_a,title:'You / '+name(c.agent_a),owner:true});
  return [...owners.values(),...conversations.filter(c=>c.agent_a!==c.agent_b).map(c=>({key:c.id,id:c.id,a:c.agent_a,b:c.agent_b,title:name(c.agent_a)+' / '+name(c.agent_b),owner:false}))];
}
export function threadMessages(id:string,history:ChatMessage[],recent:ChatMessage[]) {
  return [...new Map([...history,...recent].filter(m=>m.conversation_id===id).map(m=>[m.id,m])).values()].sort((a,b)=>Number(a.sequence)-Number(b.sequence));
}
export function participantTone(id:string,agents:ChatAgent[]) {
  if(id==='owner')return 'owner';
  const role=agents.find(a=>a.id===id)?.role;
  return role==='development'?'developer':role==='deployment'?'deployment':'other';
}
