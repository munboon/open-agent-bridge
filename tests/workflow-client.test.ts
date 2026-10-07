import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect,vi} from 'vitest';
import {recordedMutation} from '../scripts/bridge-client.mjs';

describe('durable milestone updates',()=>{
  it('records the exact payload before a lost response and retries with authorization',async()=>{
    const root=await mkdtemp(join(tmpdir(),'workflow-client-'));
    try{
      const body={kind:'blocker',body:'Synthetic dependency is unavailable.'};
      const send=vi.fn().mockRejectedValueOnce(Error('Lost response')).mockResolvedValueOnce({id:'recorded'}).mockRejectedValueOnce(Object.assign(Error('Revoked'),{status:401}));
      await expect(recordedMutation(root,{},'board/posts',body,'milestone-0001',send)).rejects.toThrow('Lost response');
      const records=await readdir(join(root,'mutations'));
      expect(JSON.parse(await readFile(join(root,'mutations',records[0]),'utf8'))).toMatchObject({payload:JSON.stringify(body),key:'milestone-0001'});
      expect(await recordedMutation(root,{},'board/posts',body,'milestone-0001',send)).toEqual({id:'recorded'});
      expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
      await expect(recordedMutation(root,{},'board/posts',body,'milestone-0001',send)).rejects.toThrow('Revoked');
      await expect(recordedMutation(root,{},'board/posts',{...body,body:'Different'},'milestone-0001',send)).rejects.toThrow('different saved payload');
      expect(send).toHaveBeenCalledTimes(3);
    }finally{await rm(root,{recursive:true});}
  });
  it('serializes simultaneous retries and keeps different work reports independent',async()=>{
    const root=await mkdtemp(join(tmpdir(),'workflow-concurrent-'));
    try{
      const send=vi.fn().mockResolvedValue({reported:true}),body={state:'working',title:'Synthetic checks',summary:'Running.'};
      const results=await Promise.allSettled([recordedMutation(root,{},'activity',body,'activity-0001',send),recordedMutation(root,{},'activity',{...body,summary:'Changed'},'activity-0001',send)]);
      expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(send).toHaveBeenCalledTimes(1);
      await recordedMutation(root,{},'activity',{...body,state:'completed'},'activity-0002',send);
      await expect(recordedMutation(root,{},'activity',body,'bad',send)).rejects.toThrow('stable key');
      await expect(recordedMutation(root,{},'messages',body,'valid-key',send)).rejects.toThrow('Unsupported');
    }finally{await rm(root,{recursive:true});}
  });
});
