'use client';
import {useEffect,useState} from 'react';
import {api,Icon,Modal,Notice} from './ui';
export type SetupPrompt={projectId:string;agentId:string;agentName:string;enrollment_id:string;prompt:string;expires_at:string};
type Registration={status:'pending'|'claimed'|'expired'|'revoked';expires_at:string;registered_at:string|null};
export function AgentSetupPrompt({setup,onClose}:{setup:SetupPrompt;onClose:()=>void}){
 const [status,setStatus]=useState<Registration['status']>('pending'),[unavailable,setUnavailable]=useState(false),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
 useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;
  async function check(){let waiting=true;try{const result=await api<Registration>(`/api/admin/projects/${setup.projectId}/agents/${setup.agentId}/enrollments/${setup.enrollment_id}`);if(active){setStatus(result.status);setUnavailable(false);}waiting=result.status==='pending';}catch{if(active)setUnavailable(true);}finally{if(active&&waiting)timer=setTimeout(check,3000);}}
  void check();return()=>{active=false;clearTimeout(timer);};
 },[setup.projectId,setup.agentId,setup.enrollment_id]);
 const waiting=status==='pending';
 const visible=waiting?setup.prompt:setup.prompt.replace(/^Enrollment code: .*$/m,`Enrollment code: [${status==='claimed'?'used':status}]`);
 async function copy(){try{await navigator.clipboard.writeText(visible);setCopied(true);setCopyError(false);}catch{setCopyError(true);}}
 return <Modal title={`Set up ${setup.agentName}`} onClose={onClose} className="agent-setup-prompt">
  <p>Read the instructions, then copy and paste them into the intended coding agent.</p>
  <Notice>{status==='claimed'?'Registered. This setup code has been used and cannot enroll another installation.':status==='expired'?'This setup has expired. Close this window and generate fresh setup.':status==='revoked'?'This setup was replaced or revoked. Close this window and generate fresh setup.':`Waiting for registration. The one-time code expires ${new Date(setup.expires_at).toLocaleString()}.`}</Notice>
  {unavailable&&<p role="status" className="supporting">Registration status is temporarily unavailable. Checking again shortly.</p>}
  <label className="setup-prompt-text">Setup instructions<textarea aria-label="Setup instructions" value={visible} readOnly spellCheck={false}/></label>
  <p className="supporting">The code is consumed when the agent registers its key. Its ongoing connection uses that private key. Closing this window clears the prompt from this page; you can generate fresh setup if needed.</p>
  {copyError&&<p role="alert">Copy was blocked. Select the instructions above and copy them manually.</p>}
  <div className="modal-actions"><button type="button" className="button button-text" onClick={onClose}>Close</button><button type="button" className="button button-primary" disabled={!waiting} onClick={()=>void copy()}><Icon name="copy"/>{copied&&waiting?'Copied':'Copy setup prompt'}</button></div>
 </Modal>;
}
