import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { QuietTransfers, workspacePath } from '../scripts/quiet-transfer.mjs';

const roots:string[]=[], managers:any[]=[];
afterEach(async()=>{for(const manager of managers.splice(0))await manager.shutdown();for(const root of roots.splice(0)){if(!resolve(root).startsWith(resolve(tmpdir())+'\\')&&process.platform==='win32')throw Error('Cleanup outside temp');await rm(root,{recursive:true,force:true});}});
describe('quiet file transfers with real HTTP helpers',()=> {
  it('closes a supervised child when its parent pipe closes',async()=>{
    const python=process.platform==='win32'?'python':'python3';
    const child=spawn(python,['-B',resolve('helpers/tunnel_process.py'),python,'-u','-c','import os,time; print(os.getpid(),flush=True); time.sleep(120)'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const exited=new Promise<void>((res,rej)=>{child.once('exit',code=>code===0?res():rej(Error('Supervisor failed')));child.once('error',rej);});
    const lines=createInterface({input:child.stdout});
    try {
      const pid=await new Promise<number>((res,rej)=>{const timer=setTimeout(()=>rej(Error('Child startup timeout')),5000);lines.once('line',line=>{clearTimeout(timer);res(Number(line));});});
      expect(pid).toBeGreaterThan(0);child.stdin.end();await exited;
      expect(()=>process.kill(pid,0)).toThrow();
    } finally {child.stdin.end();lines.close();}
  },15000);
  for(const direction of ['download','upload'])it(`verifies ${direction} bytes without returning tokens`,async()=> {
    const root=await mkdtemp(resolve(tmpdir(),'open-agent-bridge-quiet-'));roots.push(root);
    const dev=resolve(root,'dev'),dep=resolve(root,'dep');await mkdir(dev,{mode:0o700});await mkdir(dep,{mode:0o700});
    const bytes=Buffer.from('Synthetic artifact\0with a measured digest.');
    await writeFile(resolve(direction==='download'?dev:dep,'sample.bin'),bytes);
    const id=randomUUID();let transfer:any,offer:any,secret='';const receipts:any[]=[];
    const bridge=async(path:string,body?:any)=>{
      if(path===`transfers/${id}`)return {transfer,offers:offer?[offer]:[]};
      if(path===`transfers/${id}/offers`){secret=body.token;offer={id:randomUUID(),origin:body.origin};transfer.current_offer_id=offer.id;return {offer};}
      if(path.endsWith('/credential'))return {token:secret,origin:offer.origin};
      if(path.endsWith('/receipts')){receipts.push(body);return {receipt:body};}
      if(path.endsWith('/events'))return {};
      throw Error('Unexpected bridge path');
    };
    const manager=(cwd:string,agentId:string)=>new QuietTransfers({cwd,stateDir:resolve(root,agentId+'-state'),bridge,agentId,helper:resolve('helpers/transfer_server.py'),allowLoopback:process.env.QUIET_PUBLIC_TRANSFER!=='1'});
    const developer=manager(dev,'dev'),deployment=manager(dep,'dep');managers.push(developer,deployment);
    const manifest=await (direction==='download'?developer:deployment).operation({action:'manifest',path:'sample.bin'});
    transfer={id,manifest,direction,state:'requested',host_id:'dev',source_id:direction==='download'?'dev':'dep',destination_id:direction==='download'?'dep':'dev'};
    const hosted=await developer.operation({action:'host',transfer_id:id,path:'sample.bin'});
    expect(secret.length).toBeGreaterThan(40);expect(JSON.stringify(hosted)).not.toContain(secret);
    const result=await deployment.operation({action:direction==='download'?'receive':'send',transfer_id:id,path:'sample.bin'});
    expect(JSON.stringify(result)).not.toContain(secret);
    if(direction==='upload')await developer.operation({action:'finalize',transfer_id:id});
    expect(await readFile(resolve(direction==='download'?dep:dev,'sample.bin'))).toEqual(bytes);
    expect(receipts.at(-1)).toMatchObject({kind:'verified',measured_size:bytes.length,measured_sha256:manifest.sha256});
    await developer.operation({action:'close',transfer_id:id});expect(developer.hosts.size).toBe(0);
  },120000);
  it('rejects paths outside the workspace',async()=>{
    const root=await mkdtemp(resolve(tmpdir(),'open-agent-bridge-quiet-'));roots.push(root);
    await expect(workspacePath(root,'../outside',false)).rejects.toThrow();
    await expect(workspacePath(root,'C:/outside',false)).rejects.toThrow();
  });
  it('recovers an uncertain finalize receipt with the saved mutation key',async()=>{
    const root=await mkdtemp(resolve(tmpdir(),'open-agent-bridge-quiet-'));roots.push(root);
    const id=randomUUID(), offer={id:randomUUID()}, key=randomUUID();
    const payload={offer_id:offer.id,kind:'verified',measured_size:12,measured_sha256:'measured'};
    await writeFile(resolve(root,`${id}-receipt.json`),JSON.stringify({payload,key}));
    const calls:any[]=[];
    const bridge=async(path:string,body?:any,mutationKey?:string)=>{
      if(path===`transfers/${id}`)return {transfer:{id,state:'verified',current_offer_id:offer.id},offers:[offer]};
      calls.push({path,body,key:mutationKey});return {};
    };
    const manager=new QuietTransfers({cwd:root,stateDir:root,bridge,agentId:'dev',helper:'unused'});managers.push(manager);
    expect(await manager.operation({action:'finalize',transfer_id:id})).toMatchObject({recovered:true,kind:'verified'});
    expect(calls).toEqual([{path:`transfers/${id}/receipts`,body:payload,key}]);
  });
});
