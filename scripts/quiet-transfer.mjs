import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, realpath, open, readFile, writeFile, mkdir, link, unlink } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, basename } from 'node:path';
import { createInterface } from 'node:readline';

const hash = data => createHash('sha256').update(data).digest('hex');
const uuid = value => { if(!/^[a-f0-9-]{36}$/.test(value??''))throw Error('Invalid transfer ID');return value; };
export async function workspacePath(root, name, existing=true) {
  if(typeof name!=='string'||isAbsolute(name)||name.split(/[\\/]/).some(p=>p==='..'||p==='')||name.includes(':'))throw Error('Use a relative workspace path');
  const base=await realpath(root), target=resolve(base,name), rel=relative(base,target);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Path is outside workspace');
  let walk=base;
  const parts=rel.split(/[\\/]/);
  for(let i=0;i<parts.length;i++) {
    walk=resolve(walk,parts[i]);
    try { const stat=await lstat(walk);if(stat.isSymbolicLink())throw Error('Links are not permitted'); }
    catch(e) {if(e.code==='ENOENT'&&!existing&&i===parts.length-1)break;throw e;}
  }
  return target;
}
async function measure(path, parts=false) {
  const file=await open(path,'r');const all=createHash('sha256');const chunks=[];let offset=0;
  try { const size=(await file.stat()).size;if(size>10*1024**3)throw Error('File exceeds 10 GiB');
    do { const buffer=Buffer.alloc(Math.min(8*1024**2,size-offset));let got=0;
      while(got<buffer.length){const {bytesRead}=await file.read(buffer,got,buffer.length-got,offset+got);if(!bytesRead)throw Error('Source changed while reading');got+=bytesRead;}
      all.update(buffer);if(parts)chunks.push({index:chunks.length,offset,size:got,sha256:hash(buffer)});offset+=got;
    } while(offset<size);
    return {size,sha256:all.digest('hex'),...(parts?{parts:chunks}:{})};
  } finally {await file.close();}
}
async function stop(child, graceful=false) {
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise(r=>child.once('exit',r));
  if(graceful)child.stdin.end();else child.kill();
  await Promise.race([exited,new Promise(r=>setTimeout(r,graceful?7000:2000))]);
  if(child.exitCode===null&&child.signalCode===null)throw Error('Transfer process did not exit');
}
export class QuietTransfers {
  constructor({cwd,stateDir,bridge,agentId,helper,python=process.platform==='win32'?'python':'python3',cloudflared='cloudflared',allowLoopback=false}) {
    Object.assign(this,{cwd,stateDir,bridge,agentId,helper,python,cloudflared,allowLoopback});this.hosts=new Map();this.abort=new AbortController();
  }
  async operation(args) {
    if(args.action==='manifest') {
      const path=await workspacePath(this.cwd,args.path);
      return {filename:basename(path),...await measure(path,true),sensitivity:'internal'};
    }
    const id=uuid(args.transfer_id), {transfer,offers}=await this.bridge('transfers/'+id);
    if(args.action==='close') {await this.close(id);return {closed:true};}
    if(['cancelled','failed'].includes(transfer.state))throw Error('Transfer is not active');
    if(args.action==='host')return this.host(transfer,args.path);
    const offer=offers.find(o=>o.id===transfer.current_offer_id);
    if(!offer)throw Error('No current transfer offer');
    if(!['receive','send','finalize'].includes(args.action))throw Error('Unknown transfer action');
    const checkpoint=resolve(this.stateDir,`${id}-receipt.json`);
    try {
      const pending=JSON.parse(await readFile(checkpoint,'utf8'));
      if(pending.payload.offer_id!==offer.id)throw Error('Previous offer receipt requires reconciliation');
      await this.bridge(`transfers/${id}/receipts`,pending.payload,pending.key);await unlink(checkpoint);
      return {kind:pending.payload.kind,size:pending.payload.measured_size,sha256:pending.payload.measured_sha256,recovered:true};
    }catch(e){if(e.code!=='ENOENT')throw e;}
    if(args.action==='finalize') {
      const host=this.hosts.get(id);if(!host||transfer.direction!=='upload')throw Error('No owned upload endpoint');
      const finalized=await this.endpoint(host.localOrigin,'/v1/finalize',host.token,'POST',undefined,true);await finalized.arrayBuffer();
      const measured=await measure(host.path);return this.receipt(transfer,offer,'verified',measured);
    }
    const receiving=args.action==='receive';
    if(receiving ? transfer.destination_id!==this.agentId||transfer.direction!=='download' : transfer.source_id!==this.agentId||transfer.direction!=='upload')throw Error('Action does not match assigned role');
    const access=await this.bridge(`transfers/${id}/offers/${offer.id}/credential`,{});
    if(access.origin!==offer.origin)throw Error('Transfer origin changed');
    const path=await workspacePath(this.cwd,args.path,!receiving), manifest=transfer.manifest;
    if(receiving) {
      try {
        await lstat(path);const measured=await measure(path);
        if(measured.size!==manifest.size||measured.sha256!==manifest.sha256)throw Error('Destination exists with different content');
        return await this.receipt(transfer,offer,'verified',measured);
      } catch(e) {if(e.code!=='ENOENT')throw e;}
      // Never overwrite. Publish only after independent whole-file verification.
      try {await lstat(path);throw Error('Destination exists; choose a new staging filename');} catch(e){if(e.code!=='ENOENT')throw e;}
      const temp=path+'.'+randomUUID()+'.partial';const output=await open(temp,'wx',0o600);
      try {
        for(const part of manifest.parts) {
          const response=await this.endpoint(access.origin,`/v1/parts/${part.index}`,access.token,'GET');
          let size=0;const digest=createHash('sha256');
          for await(const chunk of response.body) {size+=chunk.length;if(size>part.size)throw Error('Oversized part');digest.update(chunk);await output.writeFile(chunk);}
          if(size!==part.size||digest.digest('hex')!==part.sha256)throw Error('Part digest mismatch');
        }
        await output.close();const measured=await measure(temp);
        if(measured.size!==manifest.size||measured.sha256!==manifest.sha256)throw Error('File digest mismatch');
        await link(temp,path); // Atomic no-clobber publication on the same volume.
        return await this.receipt(transfer,offer,'verified',measured);
      } finally {await output.close().catch(()=>{});await unlink(temp).catch(()=>{});}
    }
    const measured=await measure(path);if(measured.size!==manifest.size||measured.sha256!==manifest.sha256)throw Error('Source does not match manifest');
    const input=await open(path,'r');
    try {for(const part of manifest.parts){const buffer=Buffer.alloc(part.size);let count=0;
      while(count<buffer.length){const {bytesRead}=await input.read(buffer,count,buffer.length-count,part.offset+count);if(!bytesRead)throw Error('Source changed');count+=bytesRead;}
      if(hash(buffer)!==part.sha256)throw Error('Source part changed');
      const response=await this.endpoint(access.origin,`/v1/parts/${part.index}`,access.token,'PUT',buffer);await response.arrayBuffer();
    }} finally {await input.close();}
    return this.receipt(transfer,offer,'uploaded',measured);
  }
  async endpoint(origin,path,token,method,body,local=false) {
    const url=new URL(origin);
    if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||((this.allowLoopback||local)&&url.protocol==='http:'&&url.hostname==='127.0.0.1')))throw Error('Approved HTTPS origin required');
    for(let attempt=0;;attempt++) {
      try {
        const response=await fetch(url.origin+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Length':String(body.length)}:{})},body,redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(120000),this.abort.signal])});
        if(response.ok)return response;
        await response.body?.cancel();const error=Error('Transfer HTTP '+response.status);error.retryable=[429,500,502,503,504].includes(response.status);throw error;
      }catch(e){if(this.abort.signal.aborted||e.retryable===false||attempt>=5)throw e;await new Promise(r=>setTimeout(r,1000*2**attempt));}
    }
  }

  async receipt(transfer,offer,kind,measured) {
    if(measured.size!==transfer.manifest.size||measured.sha256!==transfer.manifest.sha256)throw Error('Receiver file mismatch');
    const payload={offer_id:offer.id,kind,measured_size:measured.size,measured_sha256:measured.sha256,evidence:'Measured by the local transfer adapter; not deployment acceptance.'};
    let key=randomUUID();await mkdir(this.stateDir,{recursive:true});
    const checkpoint=resolve(this.stateDir,`${transfer.id}-receipt.json`);
    try {const saved=JSON.parse(await readFile(checkpoint,'utf8'));if(JSON.stringify(saved.payload)===JSON.stringify(payload))key=saved.key;}catch(e){if(e.code!=='ENOENT')throw e;}
    await writeFile(checkpoint,JSON.stringify({payload,key}),{mode:0o600});
    await this.bridge(`transfers/${transfer.id}/receipts`,payload,key);
    await unlink(checkpoint);
    return {kind,...measured};
  }
  async host(transfer,name) {
    if(transfer.host_id!==this.agentId)throw Error('Only the assigned developer can host');
    if(this.hosts.has(transfer.id))return {offer:this.hosts.get(transfer.id).offer};
    const path=await workspacePath(this.cwd,name,transfer.direction==='download');
    if(basename(path)!==transfer.manifest.filename)throw Error('Host filename must match manifest');
    const token=randomBytes(32).toString('base64url');await mkdir(this.stateDir,{recursive:true});
    const manifestPath=resolve(this.stateDir,`${transfer.id}-manifest.json`);
    const {sensitivity,encryption,...manifest}=transfer.manifest;
    await writeFile(manifestPath,JSON.stringify({...manifest,version:'1',transfer_id:transfer.id,mode:transfer.direction}),{mode:0o600});
    const env={...globalThis.process.env};for(const key of Object.keys(env))if(/TOKEN|SECRET|PASSWORD|DATABASE_URL|API_KEY/i.test(key))delete env[key];
    const process=spawn(this.python,['-B',this.helper,'--root',dirname(path),'--manifest',manifestPath,'--port','0','--ttl','900','--max-bytes',String(10*1024**3)],{windowsHide:true,env:{...env,OPEN_AGENT_BRIDGE_TRANSFER_TOKEN:token},stdio:['ignore','pipe','pipe']});
    const host={process,token,path};this.hosts.set(transfer.id,host);process.stderr.on('data',()=>{});
    try {
      const ready=await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('Transfer server startup timed out')),15000);
        process.once('error',()=>{clearTimeout(timer);rej(Error('Python transfer helper is unavailable'));});
        process.once('exit',()=>{clearTimeout(timer);rej(Error('Transfer server exited'));});
        createInterface({input:process.stdout}).once('line',line=>{clearTimeout(timer);try {const value=JSON.parse(line);if(value.event!=='ready')throw Error();res(value);}catch{rej(Error('Transfer server rejected the staging directory or manifest'));}});
      });
      host.localOrigin=`http://127.0.0.1:${ready.port}`;
      let origin;
      if(this.allowLoopback)origin=host.localOrigin;
      else {host.tunnel=spawn(this.python,['-B',resolve(dirname(this.helper),'tunnel_process.py'),this.cloudflared,'tunnel','--no-autoupdate','--url',host.localOrigin],{windowsHide:true,env,stdio:['pipe','pipe','pipe']});
      origin=await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('Cloudflare tunnel startup timed out')),45000);
        host.tunnel.once('error',()=>{clearTimeout(timer);rej(Error('Install cloudflared on the developer machine for transfers'));});
        host.tunnel.once('exit',()=>{clearTimeout(timer);rej(Error('Cloudflare tunnel exited'));});
        const line=chunk=>{const match=chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match){clearTimeout(timer);res(match[0]);}};
        host.tunnel.stdout.on('data',line);host.tunnel.stderr.on('data',line);
      });
      }
      // A printed tunnel URL is not evidence that the endpoint is reachable.
      try {const probe=await this.endpoint(origin,'/v1/status',token,'GET');await probe.arrayBuffer();}
      catch {throw Error('Transfer endpoint is not reachable. Check temporary tunnel DNS and outbound access, then retry hosting. No offer was published.');}
      const expires_at=new Date(Date.now()+840000).toISOString();
      const result=await this.bridge(`transfers/${transfer.id}/offers`,{origin,expires_at,token},randomUUID());host.offer=result.offer;
      host.timer=setTimeout(()=>void this.close(transfer.id).catch(()=>{}),840000);host.timer.unref();
      return {offer:result.offer};
    } catch(e) {await this.close(transfer.id).catch(()=>{});throw e;}
  }
  async close(id) {
    const host=this.hosts.get(id);if(!host)return;clearTimeout(host.timer);
    await stop(host.tunnel,true);await stop(host.process);this.hosts.delete(id);
    await unlink(resolve(this.stateDir,`${id}-manifest.json`)).catch(()=>{});
    if(host.offer)await this.bridge(`transfers/${id}/events`,{type:'cleanup_confirmed',offer_id:host.offer.id,evidence:'Owned endpoint and tunnel processes exited.'},randomUUID());
  }
  async shutdown() {this.abort.abort();for(const id of this.hosts.keys())await this.close(id).catch(()=>{});}
}
