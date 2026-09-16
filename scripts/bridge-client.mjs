// Vendor-neutral, session-scoped bridge client. Node.js 20+, built-ins only.
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink,lstat,realpath,open,readdir,rmdir,link} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function signedHeaders(config,method,target,body='',key=''){
 const timestamp=String(Date.now()),nonce=randomBytes(24).toString('base64url');
 const proof=['open-agent-bridge-request-v1',method,target,timestamp,nonce,sha(config.token),config.session??'',key,sha(body)].join('\n');
 return {'Content-Type':'application/json',Authorization:'Bearer '+config.token,'X-Bridge-Session':config.session??'','X-Bridge-Time':timestamp,'X-Bridge-Nonce':nonce,'X-Bridge-Proof':sign(null,Buffer.from(proof),config.privateKey).toString('base64url'),...(key?{'Idempotency-Key':key}:{})};
}
function validate(config){
 const u=new URL(config.origin);if(u.origin!==config.origin||u.username||u.password)throw Error('Use a bridge origin without a path or credentials.');
 const local=u.hostname==='localhost'||u.hostname==='127.0.0.1'||/^192\.168\./.test(u.hostname)||/^10\./.test(u.hostname)||/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname);
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&local))throw Error('The bridge must use HTTPS; private LAN development may use HTTP.');
 if(!/^[0-9a-f-]{36}$/.test(config.agentId))throw Error('Invalid agent ID.');return config;
}
async function privateDirectory(path){
 await mkdir(path,{recursive:true,mode:0o700});const stat=await lstat(path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==resolve(path))throw Error('Private storage must not use symbolic links.');
 if(process.platform==='win32'){
  const sid=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8'}).trim();
  if(!/^S-1-[0-9-]+$/.test(sid))throw Error('Unable to identify Windows account.');
  execFileSync('icacls.exe',[path,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{stdio:'pipe'});
 }else if(stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('Private storage must be owned by this user with mode 0700.');
}
export async function storage(config){
 validate(config);const base=process.platform==='win32'?join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'OpenAgentBridge'):join(homedir(),'.config','open-agent-bridge-bridge');
 const root=join(base,sha(config.origin+'\n'+config.agentId));await privateDirectory(root);return root;
}
async function atomic(path,value){const temp=path+'.'+randomUUID()+'.tmp';const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}await rename(temp,path);}
async function readPrivate(path){const file=await open(path,'r');try{const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile()||(process.platform!=='win32'&&(stat.uid!==process.getuid()||(stat.mode&0o077)!==0)))throw Error('Private file permissions are unsafe.');return JSON.parse(await file.readFile('utf8'));}finally{await file.close();}}
export async function request(config,method,path,body,key=''){
 if(!/^[a-z][a-z0-9/-]*(?:\?[A-Za-z0-9_=&%-]+)?$/.test(path))throw Error('Use a relative API path.');
 const target='/api/v1/'+path,payload=body===undefined?'':JSON.stringify(body);
 const response=await fetch(config.origin+target,{method,headers:signedHeaders(config,method,target,payload,key),body:method==='POST'?payload:undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
 const result=await response.json();if(!response.ok){const error=Error(`${result.code??'REQUEST_FAILED'}: ${result.message??'Bridge request failed.'}`);error.status=response.status;throw error;}return result;
}
async function load(file){const publicConfig=validate(JSON.parse(await readFile(file,'utf8'))),root=await storage(publicConfig),config=await readPrivate(join(root,'identity.json'));if(config.origin!==publicConfig.origin||config.agentId!==publicConfig.agentId)throw Error('Identity does not match config.');return {root,config};}
async function locked(root,name,work){
 const path=join(root,name+'.lock');
 try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;let pid;try{pid=JSON.parse(await readFile(join(path,'owner.json'),'utf8')).pid;}catch{throw Error('Unfinished local lock. Inspect before recovery.');}try{process.kill(pid,0);throw Error('Another local process is active.');}catch(error){if(error.code!=='ESRCH')throw error;}await unlink(join(path,'owner.json'));await rmdir(path);await mkdir(path,{mode:0o700});}
 await atomic(join(path,'owner.json'),{pid:process.pid});try{return await work();}finally{await unlink(join(path,'owner.json'));await rmdir(path);}
}
export async function enroll(file){
 const input=validate(JSON.parse(await readFile(file,'utf8'))),root=await storage(input);
 return locked(root,'enrollment',async()=>{
  let config;try{config=await readPrivate(join(root,'identity.json'));}catch(error){if(error.code!=='ENOENT')throw error;const keys=generateKeyPairSync('ed25519');config={origin:input.origin,agentId:input.agentId,token:input.token,privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:keys.publicKey.export({format:'pem',type:'spki'})};await atomic(join(root,'identity.json'),config);}
  const candidate={...config,token:input.token,session:undefined};await request(candidate,'POST','enrollments/claim',{public_key:candidate.publicKey});
  await atomic(join(root,'identity.json'),candidate);return {registered:true,agent_id:input.agentId};
 });
}
async function encryptionSetup(file){
 const {root,config}=await load(file);if(!config.session)throw Error('Run connect first.');
 return locked(root,'encryption',async()=>{
  const path=join(root,'recipient-key.json');let saved;
  try{saved=await readPrivate(path);}catch(error){
   if(error.code!=='ENOENT')throw error;
   const binary=process.env.AGE_KEYGEN_BINARY??'age-keygen';
   let privateKey;try{privateKey=execFileSync(binary,[],{encoding:'utf8',stdio:['pipe','pipe','pipe']});}catch{throw Error('Install age and make age-keygen available before setting up file encryption.');}
   const publicKey=execFileSync(binary,['-y'],{input:privateKey,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
   if(!/^age1[0-9a-z]{58}$/.test(publicKey))throw Error('Invalid age public key.');
   saved={privateKey,publicKey};await atomic(path,saved);
  }
  const result=await request(config,'POST','recipient-key',{scheme:'age',public_key:saved.publicKey});
  return {registered:true,fingerprint:result.fingerprint};
 });
}
async function connect(file){const {root,config}=await load(file);return locked(root,'connection',async()=>{const result=await request(config,'POST','sessions',{});config.session=result.session_id;await atomic(join(root,'identity.json'),config);const identity=await request(config,'GET','bootstrap');let encryption;try{encryption=await encryptionSetup(file);}catch(error){encryption={registered:false,message:error.status?error.message:'File encryption setup incomplete. Install age and age-keygen, then rerun encryption-setup.'};}return {connected:true,identity:identity.identity,encryption};});}
async function listen(file){const {root,config}=await load(file);if(!config.session)throw Error('Run connect first.');
 return locked(root,'listener',async()=>{
  const inbox=join(root,'inbox');await privateDirectory(inbox);let stopped=false;const stop=()=>{stopped=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);let delay=1000;
  try{while(!stopped){try{const batch=await request(config,'GET','inbox?wait_seconds=20&limit=100');for(const message of batch.messages){if(!/^[0-9a-f-]{36}$/.test(message.id))throw Error('Invalid message ID.');const path=join(inbox,message.id+'.json');try{const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(message));await file.sync();}finally{await file.close();}process.stdout.write('Bridge message stored: '+message.id+'\n');}catch(error){if(error.code!=='EEXIST')throw error;}}delay=1000;if(batch.messages.length)await sleep(10000);}catch(error){if([401,403,409,410].includes(error.status))throw error;await sleep(delay);delay=Math.min(30000,delay*2);}}}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  if(stopped){await request(config,'POST','sessions/current/close',{});delete config.session;await atomic(join(root,'identity.json'),config);}
  return {stopped:true};
 });
}
async function fileHash(path){const file=await open(path,'r');try{const hash=createHash('sha256');for await(const bytes of file.createReadStream({autoClose:false}))hash.update(bytes);return hash.digest('hex');}finally{await file.close();}}
async function upload(file,conversation,path,sensitivity='internal',operationKey=''){
 if(sensitivity!=='sensitive')return uploadBytes(file,conversation,path,sensitivity,operationKey);
 const {root,config}=await load(file),recipient=await request(config,'GET',`conversations/${conversation}/recipient-key`);
 if(recipient.scheme!=='age'||sha(recipient.public_key)!==recipient.fingerprint)throw Error('Invalid recipient encryption key.');
 const source=resolve(path),info=await lstat(source);if(!info.isFile()||info.isSymbolicLink()||info.size>1073741824)throw Error('Upload a regular file of at most 1 GiB.');
 const sourceHash=await fileHash(source),cache=join(root,'encrypted-'+sha(JSON.stringify([conversation,source,sourceHash,recipient.fingerprint,operationKey]))+'.age');
 return locked(root,'upload-'+sha(cache),async()=>{
  try{const stat=await lstat(cache);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe encrypted cache.');}catch(error){
   if(error.code!=='ENOENT')throw error;
   const temp=cache+'.'+randomUUID();
   try{execFileSync(process.env.AGE_BINARY??'age',['-r',recipient.public_key,'-o',temp,source],{stdio:['ignore','pipe','pipe']});if(await fileHash(source)!==sourceHash)throw Error('Source changed during encryption.');await rename(temp,cache);}finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  return uploadBytes(file,conversation,cache,sensitivity,operationKey,{scheme:'age',recipient_fingerprint:recipient.fingerprint},path.split(/[\\/]/).at(-1));
 });
}
async function uploadBytes(file,conversation,path,sensitivity,operationKey,encryption,originalFilename){
 const {root,config}=await load(file);const handle=await open(resolve(path),'r');try{
 const info=await handle.stat();if(!info.isFile()||info.size>1073741824)throw Error('Upload a regular file of at most 1 GiB.');const hash=createHash('sha256');for await(const bytes of handle.createReadStream({autoClose:false}))hash.update(bytes);const checksum=hash.digest('hex');
 const filename=originalFilename??path.split(/[\\/]/).at(-1);const payload={conversation_id:conversation,filename,size:info.size,sha256:checksum,sensitivity,...(encryption?{encryption}:{})};const ledger=join(root,'upload-'+sha(JSON.stringify(payload)+'\n'+operationKey)+'.json');let saved;try{saved=await readPrivate(ledger);}catch(error){if(error.code!=='ENOENT')throw error;saved={key:randomUUID()};await atomic(ledger,saved);}
 const pkg=await request(config,'POST','packages',payload,saved.key);const current=await request(config,'GET','packages/'+pkg.id);
 if(current.state==='uploading'){for(let part=0,offset=0;offset<info.size;part++,offset+=pkg.chunk_bytes){const bytes=Buffer.alloc(Math.min(pkg.chunk_bytes,info.size-offset));const read=await handle.read(bytes,0,bytes.length,offset);if(read.bytesRead!==bytes.length)throw Error('Source changed during upload.');const checksum=sha(bytes),existing=current.parts.find(p=>p.part===part);if(existing){if(existing.sha256!==checksum)throw Error('Source changed since earlier upload.');continue;}await request(config,'POST',`packages/${pkg.id}/parts/${part}`,{data:bytes.toString('base64'),sha256:checksum});}await request(config,'POST',`packages/${pkg.id}/complete`,{});}
 return {package_id:pkg.id,sha256:checksum,size:info.size,expires_at:pkg.expires_at,already_verified:current.state==='verified'};
 }finally{await handle.close();}
}
async function download(file,id,destination){
 const {root,config}=await load(file);const pkg=await request(config,'GET','packages/'+id);
 if(!['ready','verified'].includes(pkg.state))throw Error('Package is not ready.');
 const output=resolve(destination),staging=output+'.'+id+'.parts';await privateDirectory(staging);
 // Keep verified parts across interruptions. Never replace an existing output.
 const whole=createHash('sha256');let size=0;
 for(const part of pkg.parts){const path=join(staging,String(part.part));let bytes;
  try{if((await lstat(path)).isSymbolicLink())throw Error('Unsafe staged part.');bytes=await readFile(path);if(bytes.length!==part.size||sha(bytes)!==part.sha256)throw Error('Staged part integrity failed.');}
  catch(error){if(error.code!=='ENOENT')throw error;const data=await request(config,'GET',`packages/${id}/parts/${part.part}`);bytes=Buffer.from(data.data,'base64');if(bytes.length!==part.size||sha(bytes)!==part.sha256)throw Error('Part integrity failed.');const temporary=path+'.'+randomUUID()+'.tmp';const partFile=await open(temporary,'wx',0o600);try{await partFile.writeFile(bytes);await partFile.sync();}finally{await partFile.close();}await rename(temporary,path);}
  whole.update(bytes);size+=bytes.length;
 }
 const checksum=whole.digest('hex');if(size!==Number(pkg.size)||checksum!==pkg.sha256)throw Error('Package integrity failed.');
 const temporary=join(staging,'complete-'+randomUUID());const handle=await open(temporary,'wx',0o600);
 try{for(const part of pkg.parts)await handle.writeFile(await readFile(join(staging,String(part.part))));await handle.sync();}finally{await handle.close();}
 let ready=temporary,keyFile;
 try{
  if(pkg.encryption){
   const saved=await readPrivate(join(root,'recipient-key.json'));
   if(pkg.encryption.scheme!=='age'||sha(saved.publicKey)!==pkg.encryption.recipient_fingerprint)throw Error('This installation does not have the matching file encryption key.');
   keyFile=join(root,'decrypt-'+randomUUID()+'.key');await writeFile(keyFile,saved.privateKey,{flag:'wx',mode:0o600});
   ready=join(staging,'decrypted-'+randomUUID());
   execFileSync(process.env.AGE_BINARY??'age',['-d','-i',keyFile,'-o',ready,temporary],{stdio:['ignore','pipe','pipe']});
  }
  try{await link(ready,output);}catch(error){if(error.code!=='EEXIST')throw error;const stat=await lstat(output);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Unsafe destination.');if(await fileHash(output)!==await fileHash(ready))throw Error('Destination already exists with different bytes.');}
 }finally{if(keyFile)await unlink(keyFile);if(ready!==temporary)await unlink(ready).catch(error=>{if(error.code!=='ENOENT')throw error;});await unlink(temporary);}
 await request(config,'POST',`packages/${id}/receipt`,{size,sha256:checksum});
 for(const part of pkg.parts)await unlink(join(staging,String(part.part)));await rmdir(staging);
 return {verified:true,package_id:id,path:output};
}
export async function main(args){const [command,file,...rest]=args;if(!file)throw Error('Usage: bridge-client.mjs enroll|connect|listen|inbox|request|upload|download <config-file> ...');
 if(command==='encryption-setup')return encryptionSetup(file);
 if(command==='enroll')return enroll(file);if(command==='connect')return connect(file);if(command==='listen')return listen(file);
 if(command==='upload')return upload(file,...rest);if(command==='download')return download(file,...rest);
 const {root,config}=await load(file);
 if(command==='inbox'){const dir=join(root,'inbox');await privateDirectory(dir);return Promise.all((await readdir(dir)).filter(n=>/^[0-9a-f-]{36}\.json$/.test(n)).map(n=>readPrivate(join(dir,n))));}
 if(command==='request'){const [method,path,jsonFile,key]=rest;if(!['GET','POST'].includes(method))throw Error('Use GET or POST.');const body=jsonFile?JSON.parse(await readFile(jsonFile,'utf8')):undefined;if(method==='POST'&&!key&&/^(messages|tasks|conversations|packages)$/.test(path))throw Error('Supply a stable idempotency key after the JSON file; reuse it for retries.');return request(config,method,path,body,key);}
 throw Error('Unknown command.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).then(result=>{if(result!==undefined)process.stdout.write(JSON.stringify(result)+'\n');}).catch(error=>{process.stderr.write((error.status?error.message:'Local client operation failed. Check files, permissions, runtime and network; preserve the private key for recovery.')+'\n');process.exitCode=1;});
