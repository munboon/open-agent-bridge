'use client';
import {useId,useState} from 'react';
import {promptTemplateNames,roleWorkInstructions,templateDescriptions,type PromptTemplate} from '../lib/agent-instructions';
export type InstructionDraft={prompt_template:PromptTemplate;work_instructions:string};
export const initialInstructions=():InstructionDraft=>({prompt_template:'discovery',work_instructions:roleWorkInstructions('discovery')});
export function AgentInstructionsFields({value,onChange,busy=false}:{value:InstructionDraft;onChange:(value:InstructionDraft)=>void;busy?:boolean}){
 const help=useId();
 const customized=value.work_instructions.trim()!==roleWorkInstructions(value.prompt_template).trim();
 function select(template:PromptTemplate){
  if(customized&&!window.confirm('Replace your edited instructions with the selected template?'))return;
  onChange({prompt_template:template,work_instructions:roleWorkInstructions(template)});
 }
 function reset(){if(!customized||window.confirm('Reset these instructions to the template? Your edits will be replaced.'))onChange({...value,work_instructions:roleWorkInstructions(value.prompt_template)});}
 return <div className="agent-instructions-fields">
  <label>Starting template<select aria-label="Starting template" name="prompt_template" disabled={busy} value={value.prompt_template} onChange={e=>select(e.target.value as PromptTemplate)}>{Object.entries(promptTemplateNames).map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label>
  <p className="supporting">{templateDescriptions[value.prompt_template]}</p>
  <label>Agent instructions<textarea aria-label="Agent instructions" name="work_instructions" required maxLength={16000} rows={7} value={value.work_instructions} disabled={busy} aria-describedby={help} placeholder="Describe this agent's purpose, responsibilities, boundaries, expected outputs and when to hand work to another agent." onChange={e=>onChange({...value,work_instructions:e.target.value})}/></label>
  <div className="instruction-editor-meta"><span className="supporting">{customized?'Customized instructions':'Template instructions'}</span><button type="button" className="button button-text" disabled={busy||!customized} onClick={reset}>Reset to template</button></div>
  <p className="supporting" id={help}>Included in this agent's setup. These instructions guide behavior; they do not grant access or override the host's rules.</p>
 </div>;
}
export function NewAgentInstructions({busy=false}:{busy?:boolean}){const [draft,setDraft]=useState(initialInstructions);return <AgentInstructionsFields value={draft} onChange={setDraft} busy={busy}/>;}
