import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {replyMessage} from '../scripts/bridge-client.mjs';
let root:string;
const id='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222',own='33333333-3333-4333-8333-333333333333',conversation='44444444-4444-4444-8444-444444444444';
async function incoming(author_type='agent'){await writeFile(join(root,'inbox',id+'.json'),JSON.stringify({id,author_type,sender_id:peer,conversation_id:conversation}),{mode:0o600});}
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'oab-reply-'));await mkdir(join(root,'inbox'),{mode:0o700});await incoming();});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
describe('portable reply command',()=>{
 it('routes peer replies and acknowledges only after sending, without duplicates on retry',async()=>{
  const send=vi.fn().mockResolvedValue({id:'reply-id'});
  await replyMessage(root,{agentId:own},id,'hello',send);await replyMessage(root,{agentId:own},id,'hello',send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0].slice(1)).toEqual(['POST','messages',{conversation_id:conversation,recipient_agent_id:peer,type:'note',body:'hello'},'reply-'+id]);
  expect(send.mock.calls[1][2]).toBe('acknowledgements');
  await expect(replyMessage(root,{agentId:own},id,'changed',send)).rejects.toThrow('different saved reply');
 });
 it('routes owner replies back to the owner conversation',async()=>{
  await incoming('owner');const send=vi.fn().mockResolvedValue({id:'reply-id'});await replyMessage(root,{agentId:own},id,'hello',send);
  expect(send.mock.calls[0][3].recipient_agent_id).toBe(own);
 });
 it('does not acknowledge a failed send and retries with the same idempotency key',async()=>{
  const send=vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({id:'reply-id'});
  await expect(replyMessage(root,{agentId:own},id,'hello',send)).rejects.toThrow('network');expect(send).toHaveBeenCalledTimes(1);
  await replyMessage(root,{agentId:own},id,'hello',send);expect(send.mock.calls[0][4]).toBe(send.mock.calls[1][4]);
 });
 it('retries a failed acknowledgement without resending the reply',async()=>{
  const send=vi.fn().mockResolvedValueOnce({id:'reply-id'}).mockRejectedValueOnce(Error('network')).mockResolvedValue({});
  await expect(replyMessage(root,{agentId:own},id,'hello',send)).rejects.toThrow();await replyMessage(root,{agentId:own},id,'hello',send);
  expect(send.mock.calls.map(c=>c[2])).toEqual(['messages','acknowledgements','acknowledgements']);
 });
 it('rejects system messages and path traversal before sending',async()=>{
  await incoming('system');const send=vi.fn();await expect(replyMessage(root,{agentId:own},id,'hello',send)).rejects.toThrow();
  await expect(replyMessage(root,{agentId:own},'../other','hello',send)).rejects.toThrow();expect(send).not.toHaveBeenCalled();
 });
});
