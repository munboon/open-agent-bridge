'use client';
import {useEffect,useState} from 'react';
import {templateDescriptions,type PromptTemplate} from '../lib/agent-instructions';
import {api,Modal,Notice,problemText} from './ui';
import {AgentAvatar} from './AgentAvatar';
import {agentIcons,agentColors,defaultAppearance,type AgentAppearance} from '../lib/agent-appearance';
type Prompt={appearance?:AgentAppearance|null;description:string;name:string;chat_visible:boolean;instructions:string;work_instructions:string;default_instructions:string;prompt_template:string;templates:{id:string;name:string;instructions:string}[];customized:boolean;revision:number;runtime:string;startup:string};
function ReadPrompt({text}:{text:string}) {
  const blocks=text.split(/\n\s*\n/).filter(Boolean);
  return <div className="prompt-prose">{blocks.map((block,index)=>{
    const lines=block.split('\n');
    if(lines.every(line=>/^[-*] /.test(line)))return <ul key={index}>{lines.map((line,i)=><li key={i}>{line.slice(2)}</li>)}</ul>;
    if(lines.every(line=>/^\d+\. /.test(line)))return <ol key={index}>{lines.map((line,i)=><li key={i}>{line.replace(/^\d+\. /,'')}</li>)}</ol>;
    return lines.map((line,i)=>/^#{1,6} /.test(line)?<h3 key={index+'-'+i}>{line.replace(/^#{1,6} /,'')}</h3>:<p key={index+'-'+i}>{line}</p>);
  })}</div>;
}
export function AgentPromptPreview({projectId,agent,onClose,onAction}:{projectId:string;agent:{id:string;name:string;active:boolean};onClose:()=>void;onAction:(action:'download'|'replace'|'key'|'state'|'revoke'|'takeover')=>void}) {
  const [content,setContent]=useState<Prompt|null>(null);
  const [appearance,setAppearance]=useState<AgentAppearance>(defaultAppearance);
  const [imageBusy,setImageBusy]=useState(false);
  const [description,setDescription]=useState('');
  const [draft,setDraft]=useState(''),[template,setTemplate]=useState('');
  const [name,setName]=useState(''),[quiet,setQuiet]=useState(false),[section,setSection]=useState<'settings'|'prompt'|'access'>('settings');
  const [editing,setEditing]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[saved,setSaved]=useState(false);
  const path=`/api/admin/projects/${projectId}/agents/${agent.id}/instructions`;
  const dirty=!!content&&(JSON.stringify(appearance)!==JSON.stringify(content.appearance??defaultAppearance)||description!==content.description||draft!==content.work_instructions||template!==content.prompt_template||name!==content.name||quiet===content.chat_visible);
  function accept(value:Prompt){setContent(value);setAppearance(value.appearance??defaultAppearance);setDescription(value.description);setDraft(value.work_instructions);setTemplate(value.prompt_template);setName(value.name);setQuiet(!value.chat_visible);}
  useEffect(()=>{
    let active=true;
    api<Prompt>(path).then(value=>{if(active)accept(value);}).catch(e=>{if(active)setError(problemText(e));});
    return()=>{active=false;};
  },[path]);
  async function uploadImage(file:File|undefined){
    if(!file)return;
    setError('');
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){setError('Choose a PNG, JPEG or WebP image under 5 MB.');return;}
    setImageBusy(true);
    try {
      const bitmap=await createImageBitmap(file);
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image processing is unavailable.');
      const size=Math.min(bitmap.width,bitmap.height);
      ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,128,128);bitmap.close();
      const image=canvas.toDataURL('image/png');
      if(image.length>90000)throw Error('This image is too detailed. Choose a simpler image.');
      setAppearance(value=>({...value,image}));setSaved(false);
    }catch(error){setError(error instanceof Error?error.message:'Could not read this image.');}finally{setImageBusy(false);}
  }
  function close(){if(!dirty||window.confirm('Discard unsaved agent settings?'))onClose();}
  function selectTemplate(value:string){
    if(draft!==content!.work_instructions&&!window.confirm('Replace your unsaved draft with this template?'))return;
    setTemplate(value);setDraft(content!.templates.find(item=>item.id===value)!.instructions);setSaved(false);setEditing(true);
  }
  async function save(){
    setBusy(true);setError('');setSaved(false);
    try {
      const defaults=content!.templates.find(item=>item.id===template)!.instructions;
      accept(await api<Prompt>(path,{appearance,description,name,chat_visible:!quiet,prompt_template:template,work_instructions:draft.trim()===defaults.trim()?null:draft,expected_revision:content!.revision}));
      setSaved(true);
    } catch(e){setError(problemText(e));}finally{setBusy(false);}
  }
  return <Modal title={agent.name+' settings'} onClose={close} busy={busy} className="prompt-editor-modal">
    <p>Set the agent’s public description and private work instructions. Description changes appear on the next peer discovery. Instruction changes require a new setup or launch.</p>
    {error&&<Notice error>{error}</Notice>}
    {!content?!error&&<p role="status">Loading instructions…</p>:<>
      <div className="agent-settings-tabs" aria-label="Agent settings sections"><button className="button button-outline" aria-pressed={section==='settings'} onClick={()=>setSection('settings')}>General</button><button className="button button-outline" aria-pressed={section==='prompt'} onClick={()=>setSection('prompt')}>Agent instructions</button><button className="button button-outline" aria-pressed={section==='access'} onClick={()=>setSection('access')}>Access & config</button></div>
      {section==='access'?<div className="agent-general-settings"><p>Generate setup for your coding agent or manage its bridge access. {dirty?'Save your changes before continuing.':''}</p><div className="agent-access-actions">{([['download','Set up agent'],['replace','Replace config and revoke old access'],['key','File encryption key'],['takeover','Replace session'],['state',agent.active?'Temporarily disable':'Enable agent'],['revoke','Revoke all access']] as const).map(([action,label])=><button key={action} className="button button-outline" disabled={busy||dirty} onClick={()=>onAction(action)}>{label}</button>)}</div><p className="supporting">Disabling preserves credentials. Revoking access requires a new config. Neither action stops commands already running on the machine.</p></div>:section==='settings'?<div className="agent-general-settings"><label>Agent name<input aria-label="Agent name" value={name} maxLength={120} disabled={busy} onChange={event=>{setName(event.target.value);setSaved(false);}}/></label><fieldset className="agent-appearance-picker" disabled={busy||imageBusy}><legend>Agent appearance</legend><div className="agent-appearance-preview"><AgentAvatar appearance={appearance}/><span>Used in agent lists and conversations</span></div><div className="agent-icon-choices" aria-label="Agent icon">{agentIcons.map(icon=><button type="button" key={icon} aria-label={'Use '+icon+' icon'} aria-pressed={!appearance.image&&appearance.icon===icon} onClick={()=>{setAppearance({...appearance,icon,image:null});setSaved(false);}}><AgentAvatar appearance={{...appearance,icon,image:null}}/></button>)}</div><div className="agent-color-choices" aria-label="Agent color">{Object.entries(agentColors).map(([color,value])=><button type="button" key={color} aria-label={color+' color'} aria-pressed={appearance.color===color} style={{backgroundColor:value}} onClick={()=>{setAppearance({...appearance,color:color as AgentAppearance['color']});setSaved(false);}}>{appearance.color===color?'✓':''}</button>)}</div><label>Upload agent image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{void uploadImage(event.target.files?.[0]);event.target.value='';}}/></label><p className="supporting">PNG, JPEG or WebP, up to 5 MB. Images are cropped to a square. Choose an icon to remove your uploaded image.</p>{imageBusy&&<p role="status">Preparing image…</p>}</fieldset><label>Role description<textarea value={description} maxLength={1000} rows={3} disabled={busy} onChange={event=>{setDescription(event.target.value);setSaved(false);}} aria-describedby="description-help"/></label><p id="description-help" className="supporting">Shared with permitted agents in this project. Summarize responsibilities and handoffs; do not include secrets or private instructions.</p><div><label className="kit-display-option"><input aria-label="Hide display messages" type="checkbox" checked={quiet} disabled={busy} onChange={event=>{setQuiet(event.target.checked);setSaved(false);}}/>Hide display messages</label><p className="supporting">Quiet mode hides responses in the local Codex window. Portal conversations remain visible. Turn it off to use the normal Codex chat interface.</p><p className="supporting">This setting applies to Codex kits. Third-party agents control their own display.</p></div><div><h3>Project folder</h3><p>The launcher asks for the project folder on the agent's machine. It remembers the previous choice.</p></div></div>:<>
      <div className="prompt-toolbar"><label>Starting template<select aria-label="Starting template" value={template} disabled={busy} onChange={event=>selectTemplate(event.target.value)}>{content.templates.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="button-row" aria-label="Prompt view"><button className="button button-outline" aria-pressed={!editing} onClick={()=>setEditing(false)}>Read</button><button className="button button-outline" aria-pressed={editing} onClick={()=>setEditing(true)}>Edit instructions</button></div></div>
      <p className="supporting">{templateDescriptions[template as PromptTemplate]}</p>
      <div className="prompt-content">{editing?<label className="prompt-input-label">Agent work instructions<textarea aria-label="Agent work instructions" aria-describedby="prompt-help" value={draft} onChange={event=>{setDraft(event.target.value);setSaved(false);}} maxLength={16000} disabled={busy} spellCheck={false}/></label>:<ReadPrompt text={draft}/>}</div>
      <p id="prompt-help" className="supporting">These duties also apply to third-party prompt exports. Changing a template does not change access permissions. Generate fresh setup and apply it in the agent's host to use saved changes. Running agents are not updated automatically.</p>
      <details className="prompt-runtime"><summary>Bridge connection and runtime instructions</summary><p className="supporting">Included automatically in Codex kits. Local project instructions and provider settings also apply. Access keys are excluded.</p><ReadPrompt text={content.instructions.replace(content.work_instructions,'')}/><h3>Runtime</h3><ReadPrompt text={content.runtime}/><h3>Startup</h3><ReadPrompt text={content.startup}/></details>
      </>}
      <div className="prompt-save-row"><span role="status">{busy?'Saving…':saved?`Saved revision ${content.revision}. Description is available to peers; instruction changes require fresh setup.`:dirty?'Unsaved changes':'Settings loaded'}</span><div className="button-row"><button className="button button-text" hidden={section!=='prompt'} disabled={busy} onClick={()=>{if(!dirty||window.confirm('Replace your unsaved draft with the template defaults?')){setDraft(content.templates.find(item=>item.id===template)!.instructions);setSaved(false);}}}>Reset to template</button><button className="button button-outline" onClick={close} disabled={busy}>Close</button><button className="button button-primary" onClick={()=>void save()} disabled={busy||imageBusy||!dirty||!draft.trim()||!name.trim()}>Save settings</button></div></div>
    </>}
  </Modal>;
}
