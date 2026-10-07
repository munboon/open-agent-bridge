import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {fail} from './protocol';

function key(){
  const value=process.env.BRIDGE_ENVELOPE_KEY??'';
  if(!/^[A-Za-z0-9+/]{43}=$/.test(value))fail(503,'BOARD_UNAVAILABLE','Board encryption is unavailable.');
  return Buffer.from(value,'base64');
}
// Sequence gaps must not disclose how many inaccessible posts exist.
export function boardCursor(sequence:string,scope:string){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(Buffer.from('project-board-cursor-v1'));
  const data=Buffer.concat([cipher.update(JSON.stringify({sequence,scope})),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}
export function readBoardCursor(value:string,scope:string):string {
  const encryptionKey=key();
  let decoded:{sequence:string;scope:string};
  try{
    if(!/^[A-Za-z0-9_-]{32,2048}$/.test(value))throw Error('cursor');
    const bytes=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',encryptionKey,bytes.subarray(0,12));
    decipher.setAAD(Buffer.from('project-board-cursor-v1'));decipher.setAuthTag(bytes.subarray(12,28));
    decoded=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
    if(!/^\d{1,19}$/.test(decoded.sequence)||BigInt(decoded.sequence)>9223372036854775807n)throw Error('sequence');
  }catch{fail(422,'INVALID_BOARD_CURSOR','Restart board history with no cursor.');}
  if(decoded.scope!==scope)fail(409,'BOARD_VIEW_CHANGED','Access or filters changed. Restart board history with no cursor.');
  return decoded.sequence;
}
