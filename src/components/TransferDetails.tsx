'use client';

import { Badge } from './ui';

export type EndpointAttempt={id:string;origin:string;expires_at:string;revoked_at:string|null;cleanup_state?:string};
export type TransferReceipt={id:string;offer_id:string;reporter_id:string;kind:string;measured_size:number|string;measured_sha256:string;evidence:string;created_at:string;applied_to_transfer?:boolean};
type TransferDetail={id:string;current_offer_id?:string|null;cleanup_state?:string;sha256?:string;manifest?:{sha256?:string};offers?:EndpointAttempt[];receipts?:TransferReceipt[]};
const date=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const label=(value:string)=>value.replaceAll('_',' ');
const bytes=(value:string|number)=>{try{return `${BigInt(value).toLocaleString()} bytes`;}catch{return 'Size unavailable';}};

export function TransferDetails({transfer,agentName}:{transfer:TransferDetail;agentName:(id:string)=>string}){
  return <div className="task-detail transfer-detail">
    <div className="transfer-cleanup"><span>Overall endpoint cleanup</span><Badge tone={transfer.cleanup_state==='confirmed'?'success':'warning'}>{label(transfer.cleanup_state??'unknown')}</Badge></div>
    <details className="transfer-technical"><summary>Transfer identity and expected checksum</summary><dl className="detail-list"><dt>Transfer ID</dt><dd className="mono">{transfer.id}</dd><dt>Expected SHA-256</dt><dd className="mono">{transfer.manifest?.sha256??transfer.sha256??'Not reported'}</dd></dl></details>
    <h3>Endpoint attempts</h3>
    {transfer.offers?.length?<div className="transfer-records">{transfer.offers.map((offer,index)=>{
      const current=transfer.current_offer_id===offer.id;
      const expired=new Date(offer.expires_at).getTime()<=Date.now();
      const status=offer.revoked_at?'Revoked':expired?'Expired':'Live offer';
      return <article className="transfer-record" key={offer.id}>
        <div className="transfer-record-heading"><strong>Attempt {index+1}</strong><div><Badge tone={current?'info':'neutral'}>{current?'Current':transfer.current_offer_id?'Historical':'No current attempt'}</Badge><Badge tone={status==='Live offer'?'success':'neutral'}>{status}</Badge></div></div>
        <p className="transfer-origin">{offer.origin}</p>
        <dl className="detail-list"><dt>Expires</dt><dd><time dateTime={offer.expires_at}>{date(offer.expires_at)}</time></dd>{offer.revoked_at&&<><dt>Revoked</dt><dd><time dateTime={offer.revoked_at}>{date(offer.revoked_at)}</time></dd></>}<dt>Endpoint cleanup</dt><dd><Badge tone={offer.cleanup_state==='confirmed'?'success':'warning'}>{label(offer.cleanup_state??'unknown')}</Badge></dd></dl>
        <details className="transfer-technical"><summary>Offer ID · {offer.id.slice(0,8)}</summary><p className="mono">{offer.id}</p></details>
      </article>;
    })}</div>:<p className="supporting">No endpoint attempts recorded.</p>}
    <h3>Reported receipts</h3>
    {transfer.receipts?.length?<div className="transfer-records">{transfer.receipts.map(receipt=><article className="transfer-record" key={receipt.id}>
      <div className="transfer-record-heading"><strong>{label(receipt.kind)}</strong><Badge tone={receipt.offer_id===transfer.current_offer_id?'info':'neutral'}>{receipt.offer_id===transfer.current_offer_id?'Current offer':'Historical offer'}</Badge></div>
      <p className="supporting">{agentName(receipt.reporter_id)} · <time dateTime={receipt.created_at}>{date(receipt.created_at)}</time></p>
      <dl className="detail-list"><dt>Measured size</dt><dd>{bytes(receipt.measured_size)}</dd><dt>Measured SHA-256</dt><dd className="mono">{receipt.measured_sha256||'Not reported'}</dd>{receipt.applied_to_transfer!==undefined&&<><dt>Transfer state</dt><dd>{receipt.applied_to_transfer?'Receipt applied to the transfer':'Recorded without changing transfer state'}</dd></>}</dl>
      <div className="transfer-evidence"><strong>Reported evidence</strong><p>{receipt.evidence||'No evidence text supplied.'}</p></div>
      <details className="transfer-technical"><summary>Receipt and offer IDs</summary><dl className="detail-list"><dt>Receipt</dt><dd className="mono">{receipt.id}</dd><dt>Offer</dt><dd className="mono">{receipt.offer_id}</dd></dl></details>
    </article>)}</div>:<p className="supporting">No receipts reported yet.</p>}
    <details className="transfer-technical"><summary>What these reports verify</summary><p className="supporting">Verification and cleanup are agent-reported. A live offer has not expired or been revoked; endpoint reachability is not checked here. The bridge does not inspect file bytes or stop endpoints.</p></details>
  </div>;
}
