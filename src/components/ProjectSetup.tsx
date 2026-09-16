'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {browserRequestKey} from '../lib/browser-request-key';
import {api,Icon,Modal,Notice,problemText} from './ui';
import {AgentInstructionsFields,initialInstructions,type InstructionDraft} from './AgentInstructionsFields';
type AgentDraft=InstructionDraft&{id:string;name:string};
type EnvironmentDraft={id:string;name:string;agents:AgentDraft[]};
const newAgent=():AgentDraft=>({id:browserRequestKey(),name:'',...initialInstructions()});
const newEnvironment=():EnvironmentDraft=>({id:browserRequestKey(),name:'',agents:[newAgent()]});
export function ProjectSetup({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}){
 const [step,setStep]=useState(0),[name,setName]=useState(''),[client,setClient]=useState('');
 const [environments,setEnvironments]=useState<EnvironmentDraft[]>(()=>[newEnvironment()]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const form=useRef<HTMLFormElement>(null),pending=useRef<{body:string;key:string}|null>(null);
 useEffect(()=>{form.current?.querySelector<HTMLInputElement>('input')?.focus();},[step]);
 function updateEnvironment(id:string,change:Partial<EnvironmentDraft>){setEnvironments(previous=>previous.map(env=>env.id===id?{...env,...change}:env));}
 function updateAgent(env:EnvironmentDraft,id:string,change:Partial<AgentDraft>){updateEnvironment(env.id,{agents:env.agents.map(a=>a.id===id?{...a,...change}:a)});}
 async function submit(event:FormEvent){event.preventDefault();if(busy)return;setError('');
  if(step===1&&new Set(environments.map(e=>e.name.trim().toLocaleLowerCase())).size!==environments.length){setError('Give each environment a different name.');return;}
  if(step<2){setStep(step+1);return;}
  if(environments.some(env=>new Set(env.agents.map(a=>a.name.trim().toLocaleLowerCase())).size!==env.agents.length)){setError('Give each agent within an environment a different name.');return;}
  const payload={name,client_label:client,environments:environments.map(env=>({name:env.name,agents:env.agents.map(a=>({name:a.name,prompt_template:a.prompt_template,work_instructions:a.work_instructions}))}))};const body=JSON.stringify(payload);if(new TextEncoder().encode(body).length>524288){setError('This setup is too large. Shorten the instructions or create fewer agents, then add the others from Agents & access.');return;}if(pending.current?.body!==body)pending.current={body,key:browserRequestKey()};setBusy(true);
  try{const result=await api<{projectId:string}>('/api/admin/projects/provision',payload,pending.current.key);onCreated(result.projectId);}catch(e){setError(problemText(e));}finally{setBusy(false);}
 }
 const count=environments.reduce((n,e)=>n+e.agents.length,0);
 return <Modal title="Create a project" onClose={onClose} busy={busy} className="project-setup"><ol className="setup-steps" aria-label="Project setup steps">{['Project','Environments','Agents'].map((label,index)=><li key={label} aria-current={step===index?'step':undefined}>{index+1}. {label}</li>)}</ol><form ref={form} onSubmit={submit} className="form-stack"><div className="setup-fields form-stack">
  {error&&<Notice error>{error}</Notice>}
  {step===0&&<><p>Name this project and the client or organization it belongs to.</p><label>Project name<input disabled={busy} required maxLength={120} value={name} onChange={e=>setName(e.target.value)} autoComplete="off"/></label><label>Client or organization<input disabled={busy} required maxLength={120} value={client} onChange={e=>setClient(e.target.value)} autoComplete="organization"/></label></>}
  {step===1&&<><p>Add the places where your agents will work, such as an office computer, a test server or a research workspace.</p>{environments.map((env,index)=><div className="setup-environment-row" key={env.id}><label>Environment {index+1} name<input disabled={busy} required maxLength={114} value={env.name} onChange={e=>updateEnvironment(env.id,{name:e.target.value})}/></label><button type="button" className="icon-button" aria-label={`Remove environment ${index+1}`} disabled={environments.length===1} onClick={()=>setEnvironments(environments.filter(e=>e.id!==env.id))}><Icon name="trash"/></button></div>)}<button type="button" className="button button-outline" disabled={environments.length>=10} onClick={()=>setEnvironments([...environments,newEnvironment()])}><Icon name="plus"/>Add environment</button></>}
  {step===2&&<><p>Name the agents in each environment. Choose a template, then edit the instructions to fit each agent's work.</p>{environments.map(env=><fieldset className="setup-agent-group" key={env.id}><legend>{env.name}</legend>{env.agents.map((agent,index)=><div className="setup-agent-row" key={agent.id}><label>Agent {index+1} name<input disabled={busy} required maxLength={120} value={agent.name} onChange={e=>updateAgent(env,agent.id,{name:e.target.value})}/></label><button type="button" className="icon-button" aria-label={`Remove agent ${index+1} from ${env.name}`} disabled={busy||env.agents.length===1} onClick={()=>updateEnvironment(env.id,{agents:env.agents.filter(a=>a.id!==agent.id)})}><Icon name="trash"/></button><AgentInstructionsFields value={agent} onChange={change=>updateAgent(env,agent.id,change)} busy={busy}/></div>)}<button type="button" className="button button-text" disabled={busy||env.agents.length>=10||count>=50} onClick={()=>updateEnvironment(env.id,{agents:[...env.agents,newAgent()]})}><Icon name="plus"/>Add agent to {env.name}</button></fieldset>)}<p className="supporting">Create {name} with {environments.length} {environments.length===1?'environment':'environments'} and {count} {count===1?'agent':'agents'}. Access is prepared for 60 days. Agents connect only after you give them their setup.</p></>}
  </div><div className="modal-actions">{step>0?<button type="button" className="button button-text" disabled={busy} onClick={()=>{setError('');setStep(step-1);}}>Back</button>:<button type="button" className="button button-text" onClick={onClose}>Cancel</button>}<button className="button button-primary" disabled={busy}>{busy?'Creating…':step===2?'Create project':'Continue'}{step<2&&<Icon name="arrow"/>}</button></div>
 </form></Modal>;
}
