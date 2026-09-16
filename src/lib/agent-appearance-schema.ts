import {z} from 'zod';
import {agentIcons,agentColors} from './agent-appearance';
export const appearanceSchema=z.strictObject({
 icon:z.enum(agentIcons),color:z.enum(Object.keys(agentColors) as [keyof typeof agentColors,...(keyof typeof agentColors)[]]),
 image:z.string().max(90000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).refine(value=>{
  const bytes=Buffer.from(value.slice('data:image/png;base64,'.length),'base64');
  return bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)===128&&bytes.readUInt32BE(20)===128;
 },'Choose a 128-pixel PNG avatar.').nullable()
});
