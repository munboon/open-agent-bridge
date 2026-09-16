import {describe,it,expect} from 'vitest';
import {appearanceSchema} from '../src/lib/agent-appearance-schema';
import {defaultAppearance} from '../src/lib/agent-appearance';
describe('agent appearance validation',()=>{
 it('accepts named icons and colors without an image',()=>expect(appearanceSchema.parse(defaultAppearance)).toEqual(defaultAppearance));
 it('rejects external image URLs, SVG, oversized uploads and unknown options',()=>{
  for(const image of ['https://example.com/avatar.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+'A'.repeat(90000)])expect(appearanceSchema.safeParse({...defaultAppearance,image}).success).toBe(false);
  expect(appearanceSchema.safeParse({...defaultAppearance,icon:'unknown'}).success).toBe(false);
  expect(appearanceSchema.safeParse({...defaultAppearance,color:'url(evil)'}).success).toBe(false);
 });
 it('rejects PNG data with the wrong dimensions',()=>{
  const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(4096,16);bytes.writeUInt32BE(4096,20);
  expect(appearanceSchema.safeParse({...defaultAppearance,image:'data:image/png;base64,'+bytes.toString('base64')}).success).toBe(false);
 });
});
