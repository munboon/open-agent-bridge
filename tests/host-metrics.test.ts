import * as os from "node:os";
import { expect, it } from 'vitest';
import { createHostSampler } from '../scripts/host-metrics.mjs';
import { hostMetricsSchema } from '../src/lib/host-metrics';
it('samples CPU deltas and Linux available memory without counting reclaimable cache as used',async()=>{
  let idle=100,user=100;
  const system={...os,cpus:()=>[{model:'test',speed:1000,times:{idle,user,sys:0,nice:0,irq:0}}],totalmem:()=>8192,freemem:()=>1024,platform:()=> 'linux' as const};
  const sample=createHostSampler(system,async()=> 'MemAvailable:       4 kB\n');
  expect(await sample()).toMatchObject({cpu_percent:null,memory_available_bytes:4096});
  idle+=25;user+=75;
  expect(await sample()).toMatchObject({cpu_percent:75,cpu_count:1});
  expect((await sample()).cpu_percent).toBeNull();
});
it('uses Windows OS memory and validates bounded telemetry',async()=>{
  const sample=createHostSampler({...os,cpus:()=>[],totalmem:()=>8192,freemem:()=>2048,platform:()=> 'win32'},async()=>{throw Error('must not read proc');});
  expect(hostMetricsSchema.parse(await sample())).toMatchObject({platform:'win32',cpu_percent:null,memory_available_bytes:2048});
  expect(hostMetricsSchema.safeParse({...await sample(),cpu_percent:101}).success).toBe(false);
});
