import {createHash,createPublicKey,verify} from 'node:crypto';
import type {Transaction} from './db';
import {fail} from './protocol';
export type RequestProof={method:string;target:string;bodyHash:string;timestamp:string;nonce:string;signature:string;idempotency:string;accepted?:boolean};
export function proofFrom(request:Request,body:Uint8Array):RequestProof {
 const url=new URL(request.url);
 return {method:request.method,target:url.pathname+url.search,bodyHash:createHash('sha256').update(body).digest('hex'),timestamp:request.headers.get('X-Bridge-Time')??'',nonce:request.headers.get('X-Bridge-Nonce')??'',signature:request.headers.get('X-Bridge-Proof')??'',idempotency:request.headers.get('Idempotency-Key')??''};
}
export function proofText(proof:RequestProof,token:string,session:string|null|undefined){
 return ['open-agent-bridge-request-v1',proof.method,proof.target,proof.timestamp,proof.nonce,createHash('sha256').update(token).digest('hex'),session??'',proof.idempotency,proof.bodyHash].join('\n');
}
export function validPublicKey(pem:string){
 try{if(!pem.startsWith('-----BEGIN PUBLIC KEY-----\n')||pem.includes('PRIVATE KEY'))throw Error();const key=createPublicKey(pem);if(key.asymmetricKeyType!=='ed25519')throw Error();return key;}catch{fail(422,'PUBLIC_KEY','Supply an Ed25519 public key in PEM format.');}
}
export async function verifyProof(client:Transaction,credentialId:string,publicKey:string,token:string,session:string|null|undefined,proof?:RequestProof){
 if(!proof)fail(401,'KEY_PROOF_REQUIRED','This identity requires its enrolled private key.');
 // The same server request is reauthorized inside each bounded inbox poll.
 if(proof.accepted)return;
 if(!/^\d{13}$/.test(proof.timestamp)||Math.abs(Date.now()-Number(proof.timestamp))>60000||!/^[A-Za-z0-9_-]{22,86}$/.test(proof.nonce)||!/^[A-Za-z0-9_-]{86}$/.test(proof.signature))fail(401,'KEY_PROOF_INVALID','Supply a fresh signed request. Check the device clock.');
 if(!verify(null,Buffer.from(proofText(proof,token,session)),validPublicKey(publicKey),Buffer.from(proof.signature,'base64url')))fail(401,'KEY_PROOF_INVALID','The request signature is invalid.');
 const inserted=await client.query("INSERT INTO bridge_request_proofs(credential_id,nonce,expires_at) VALUES($1,$2,now()+interval '2 minutes') ON CONFLICT DO NOTHING RETURNING nonce",[credentialId,proof.nonce]);
 if(!inserted.rowCount)fail(401,'KEY_PROOF_REPLAY','This signed request was already used. Sign a new request.');
 proof.accepted=true;
}
