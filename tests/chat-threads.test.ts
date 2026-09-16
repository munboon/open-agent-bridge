import {describe,it,expect} from 'vitest';
import {chatThreads,threadMessages,participantTone} from '../src/lib/chat-threads';
describe('separate chat threads',()=>{
  const agents=[{id:'dev',name:'Developer',role:'development'},{id:'prod',name:'Production',role:'deployment'}];
  it('preserves owner thread selection when its first message creates a conversation',()=>{
    const before=chatThreads(agents,[]);
    const after=chatThreads(agents,[{id:'direct',agent_a:'dev',agent_b:'dev'},{id:'peer',agent_a:'dev',agent_b:'prod'}]);
    expect(before[0].key).toBe(after[0].key);
    expect(after.map(t=>[t.key,t.owner])).toEqual([['owner:dev',true],['owner:prod',true],['peer',false]]);
  });
  it('isolates threads, orders by sequence and updates acknowledgement without duplication',()=>{
    const message:any={id:'first',conversation_id:'direct',sequence:'1',acknowledged_at:null};
    const updated={...message,acknowledged_at:'now'};
    expect(threadMessages('direct',[message],[{...message,id:'foreign',conversation_id:'peer'},updated])).toEqual([updated]);
  });
  it('retains former agents and uses consistent speaker colors across chats',()=>{
    expect(chatThreads([],[{id:'old',agent_a:'gone',agent_b:'gone'}])[0].title).toBe('You / Former agent');
    expect(participantTone('dev',agents)).toBe('developer');
    expect(participantTone('prod',agents)).toBe('deployment');
    expect(participantTone('owner',agents)).toBe('owner');
  });
});
