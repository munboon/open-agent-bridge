import type {Handoff,PackageOutcome} from '../lib/workflow-reports';
import {Badge,Icon} from './ui';

export type HostedPackage={id:string;filename:string;size:string;state:string;sender_id:string;recipient_id:string;expires_at:string;sha256:string;purged_at?:string|null;handoff?:Handoff|null;latest_outcome?:PackageOutcome|null};
const date=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const outcomeLabels={accepted:'Accepted',validated:'Validated',applied:'Applied',completed:'Completed',blocked:'Blocked',failed:'Failed'};
export function PackageHandoff({pkg,agentName}:{pkg:HostedPackage;agentName:(id:string)=>string}){
  const outcome=pkg.latest_outcome;
  const integrity=pkg.state==='verified'?'Integrity verified':pkg.state.replaceAll('_',' ');
  const tone=outcome?.status==='completed'?'success':['blocked','failed'].includes(outcome?.status??'')?'warning':'neutral';
  return <details className="task-entry package-handoff">
    <summary><Icon name="transfer"/><span><strong>{pkg.filename}</strong><small>{agentName(pkg.sender_id)} to {agentName(pkg.recipient_id)} · {(Number(pkg.size)/1024/1024).toFixed(1)} MiB</small></span><span className="package-signals"><Badge tone={pkg.state==='verified'?'success':'neutral'}>{integrity}</Badge>{outcome&&<Badge tone={tone}>{outcomeLabels[outcome.status]}</Badge>}</span><Icon name="chevron"/></summary>
    <div className="task-detail">
      {pkg.handoff?<div className="handoff-instructions"><h3>Requested handoff</h3><dl><dt>Purpose</dt><dd>{pkg.handoff.purpose}</dd>{pkg.handoff.revision&&<><dt>Revision</dt><dd>{pkg.handoff.revision}</dd></>}<dt>Next action</dt><dd>{pkg.handoff.next_action}</dd></dl>{!!pkg.handoff.acceptance_checks?.length&&<><h3>Acceptance checks</h3><ul>{pkg.handoff.acceptance_checks.map((check,index)=><li key={index}>{check}</li>)}</ul></>}</div>:<p className="supporting">The sender did not attach handoff instructions.</p>}
      <div className="handoff-outcome"><h3>Recipient outcome</h3>{outcome?<><p><strong>{outcomeLabels[outcome.status]}</strong> · {agentName(outcome.reporter_id)} · {date(outcome.created_at)}</p><p className="handoff-evidence">{outcome.evidence}</p><p className="supporting">Reported by the recipient. File integrity and work completion are separate records.</p></>:<p className="supporting">No work outcome reported. A file receipt confirms integrity only.</p>}</div>
      <p>{pkg.purged_at?'Bridge copy removed':pkg.state==='verified'?'Integrity verified. Bridge cleanup pending.':`Download expires ${date(pkg.expires_at)}`}</p>
      <p className="supporting">Files are available only to the assigned recipient through the authenticated bridge client.</p>
      <p className="mono identifier">SHA-256: {pkg.sha256}</p>
    </div>
  </details>;
}
