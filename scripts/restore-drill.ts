/** Synthetic-only restore drill. Never accepts a database URL or existing database name. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { agentTransaction, digest, newCredential } from '../src/lib/agent-auth';
import { BridgeError } from '../src/lib/protocol';
import { taskMutation } from '../src/lib/tasks';
import { prepareGlobalRestore } from './maintain';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const local=join(root,'.local','postgres');
const binaries='C:/Program Files/PostgreSQL/16/bin';
const runId=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,17)+'_'+randomBytes(4).toString('hex');
const sourceName=`oab_drill_source_${runId}`, restoredName=`oab_drill_restored_${runId}`;
const archiveDir=join(local,'restore-drills',runId), keyDir=join(local,'restore-keys');
let stage='preflight';

function tool(executable:string,args:string[],environment:NodeJS.ProcessEnv,input?:Buffer):Promise<Buffer> {
  return new Promise((resolveOutput,reject)=>{
    const child=spawn(executable,args,{env:environment,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    const chunks:Buffer[]=[];let bytes=0;let settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolveOutput(Buffer.concat(chunks));};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Bounded local tool timeout.'));},60000);
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>16*1024*1024){child.kill();finish(new Error('Synthetic archive exceeds 16 MiB cap.'));}else chunks.push(chunk);});
    // PostgreSQL errors can contain connection details; never forward stderr.
    child.stderr.resume();child.on('error',()=>finish(new Error('Local tool failed to start.')));
    child.stdin.on('error',()=>finish(new Error('Local tool input failed.')));
    child.on('close',code=>finish(code===0?undefined:new Error('Local tool failed.')));
    child.stdin.end(input);
  });
}

async function preflight() {
  if(process.platform!=='win32'||process.argv.length>2)throw new Error('Windows project-local execution only; arguments prohibited.');
  // Native Windows checks cover reparse attributes beyond ordinary symbolic links.
  const check=String.raw`
$ErrorActionPreference='Stop'
$r=[IO.Path]::GetFullPath($env:BRIDGE_DRILL_ROOT)
$cluster=Join-Path $r '.local/postgres'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$marker=Get-Content -LiteralPath (Join-Path $cluster 'ownership.json') -Raw | ConvertFrom-Json
if($marker.kind -ne 'open-agent-bridge-local-postgres-v1' -or $marker.projectPath -ne $r -or $marker.dataPath -ne (Join-Path $cluster 'data') -or $marker.port -ne 55442 -or $marker.windowsUserSid -ne $sid){throw 'Ownership mismatch'}
foreach($target in @($r,$cluster,(Join-Path $cluster 'credentials.json'),(Join-Path $cluster 'data'),$env:BRIDGE_DRILL_ARCHIVE,$env:BRIDGE_DRILL_KEY,'C:/Program Files/PostgreSQL/16/bin')){
 $cursor=[IO.Path]::GetFullPath($target)
 if($cursor -match '(?i)(^|[\\/])OneDrive[^\\/]*([\\/]|$)'){throw 'Synced tree'}
 foreach($name in @('OneDrive','OneDriveCommercial','OneDriveConsumer')){$sync=[Environment]::GetEnvironmentVariable($name);if($sync){$sync=[IO.Path]::GetFullPath($sync).TrimEnd('\','/');if($cursor.Equals($sync,[StringComparison]::OrdinalIgnoreCase) -or $cursor.StartsWith($sync+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Synced tree'}}}
 while($cursor){if(Test-Path -LiteralPath $cursor){if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse point'}};$parent=[IO.Directory]::GetParent($cursor);if($null -eq $parent){break};$cursor=$parent.FullName}
}
foreach($path in @($cluster,(Join-Path $cluster 'credentials.json'),(Join-Path $cluster 'restore-drills'),(Join-Path $cluster 'restore-keys'),$env:BRIDGE_DRILL_ARCHIVE,$env:BRIDGE_DRILL_KEY)){
 if(Test-Path -LiteralPath $path){$acl=Get-Acl -LiteralPath $path;foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18')){throw 'Unexpected credential/archive access'}}}
}`;
  const powershellEnv={...process.env,BRIDGE_DRILL_ROOT:root,BRIDGE_DRILL_ARCHIVE:archiveDir,BRIDGE_DRILL_KEY:join(keyDir,`${runId}.json`)};
  // A parent PowerShell 7 module path cannot be inherited by Windows PowerShell 5.1.
  for(const name of Object.keys(powershellEnv))if(name.toLowerCase()==='psmodulepath')delete (powershellEnv as NodeJS.ProcessEnv)[name];
  await tool('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(check,'utf16le').toString('base64')],powershellEnv);
}

async function main(){
  await preflight();
  stage='read-owned-local-configuration';
  const credentials=JSON.parse(await readFile(join(local,'credentials.json'),'utf8')) as {adminUser:string;adminPassword:string};
  assert.equal(credentials.adminUser,'oab_local_admin');assert.match(credentials.adminPassword,/^[0-9a-f]{64}$/);
  const config={host:'127.0.0.1',port:55442,user:credentials.adminUser,password:credentials.adminPassword,max:1,connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000,application_name:'open-agent-bridge-isolated-restore-drill'};
  const admin=new Pool({...config,database:'postgres'});let source:Pool|undefined;let restored:Pool|undefined;
  const pgEnv={...process.env};for(const key of Object.keys(pgEnv))if(key.startsWith('PG'))delete pgEnv[key];
  Object.assign(pgEnv,{PGHOST:'127.0.0.1',PGPORT:'55442',PGUSER:credentials.adminUser,PGPASSWORD:credentials.adminPassword,PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=30000 -c lock_timeout=5000'});
  try{
    stage='verify-owned-cluster';
    const identity=(await admin.query("SELECT current_setting('data_directory') AS path,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version') AS version")).rows[0];
    assert.equal(resolve(identity.path).toLowerCase(),join(local,'data').toLowerCase());assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,55442);
    assert.ok(identity.version.startsWith('16.'));
    stage='create-new-drill-databases';
    for(const name of [sourceName,restoredName]){
      assert.match(name,/^oab_drill_(source|restored)_\d{17}_[a-f0-9]{8}$/);
      assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0);
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    }
    source=new Pool({...config,database:sourceName});restored=new Pool({...config,database:restoredName});
    stage='synthetic-source-migrations';
    const migrations=[];
    const names=(await readdir(join(root,'db'))).filter(name=>name.endsWith('.sql')).sort((a,b)=>a==='owner-auth.sql'?-1:b==='owner-auth.sql'?1:a.localeCompare(b));
    assert.ok(names.includes('005-transfer-attempts.sql'));
    await source.query('BEGIN');
    await source.query('CREATE TABLE bridge_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of names){const sql=await readFile(join(root,'db',name),'utf8'),hash=digest(sql);await source.query(sql);await source.query('INSERT INTO bridge_migrations(name,digest) VALUES($1,$2)',[name,hash]);migrations.push({name,sha256:hash});}
    await source.query('COMMIT');
    stage='synthetic-source-fixture';
    const owner=randomUUID(),project=randomUUID(),environment=randomUUID(),dev=randomUUID(),deploy=randomUUID(),convo=randomUUID(),claim=randomUUID(),cancel=randomUUID(),completed=randomUUID(),transfer=randomUUID(),offer=randomUUID();
    const session=randomUUID(),credential=newCredential();
    await source.query('INSERT INTO "user"(id,name,email,"createdAt","updatedAt","twoFactorEnabled") VALUES($1,\'Synthetic restore owner\',$2,now(),now(),true)',[owner,`${owner}@example.invalid`]);
    await source.query('INSERT INTO bridge_owner_state(owner_id) VALUES($1)',[owner]);
    await source.query('INSERT INTO "session"(id,"expiresAt",token,"createdAt","updatedAt","userId","bridgeMfaVerified") VALUES($1,now()+interval \'1 day\',$2,now(),now(),$3,true)',[randomUUID(),randomBytes(32).toString('hex'),owner]);
    await source.query('INSERT INTO verification(id,identifier,value,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now(),now())',[randomUUID(),`2fa-${randomUUID()}`,owner]);
    await source.query("INSERT INTO bridge_projects(id,owner_id,name,client_label) VALUES($1,$2,'Restore drill','Synthetic only')",[project,owner]);
    await source.query("INSERT INTO bridge_environments(id,project_id,name) VALUES($1,$2,'Isolated')",[environment,project]);
    for(const [id,role]of [[dev,'development'],[deploy,'deployment']])await source.query('INSERT INTO bridge_agents(id,project_id,environment_id,name,role,generation,session_id,takeover_digest) VALUES($1,$2,$3,$4,$4,3,$5,$6)',[id,project,environment,role,id===deploy?session:randomUUID(),digest(randomBytes(32).toString('hex'))]);
    await source.query("INSERT INTO bridge_credentials(id,agent_id,digest,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",[credential.id,deploy,credential.digest]);
    const[a,b]=[dev,deploy].sort();
    await source.query('INSERT INTO bridge_pairings(project_id,environment_id,agent_a,agent_b) VALUES($1,$2,$3,$4)',[project,environment,a,b]);
    await source.query('INSERT INTO bridge_conversations(id,project_id,environment_id,agent_a,agent_b,next_sequence) VALUES($1,$2,$3,$4,$5,2)',[convo,project,environment,a,b]);
    for(const [id,state]of [[claim,'claimed'],[cancel,'cancel_requested'],[completed,'completed']])await source.query("INSERT INTO bridge_tasks(id,project_id,environment_id,conversation_id,requester_id,assignee_id,title,instructions,state,claim_generation,session_generation,lease_until,cancellation_requested) VALUES($1,$2,$3,$4,$5,$6,'Synthetic task','Never execute local commands',$7,1,3,now()+interval '1 hour',$8)",[id,project,environment,convo,dev,deploy,state,state==='cancel_requested']);
    await source.query("INSERT INTO bridge_messages(id,project_id,environment_id,conversation_id,sequence,sender_id,author_type,recipient_agent_id,type,body,task_id) VALUES($1,$2,$3,$4,1,$5,'agent',$6,'note','Synthetic durable recovery context',$7)",[randomUUID(),project,environment,convo,dev,deploy,claim]);
    await source.query("INSERT INTO bridge_transfers(id,project_id,environment_id,conversation_id,source_id,destination_id,host_id,task_id,direction,manifest,state) VALUES($1,$2,$3,$4,$5,$6,$5,$7,'download',$8,'offered')",[transfer,project,environment,convo,dev,deploy,claim,{filename:'synthetic.txt',size:1,sha256:digest('x')}]);
    await source.query("INSERT INTO bridge_offers(id,transfer_id,origin,envelope,expires_at) VALUES($1,$2,'https://synthetic.example.invalid',$3,now()+interval '1 hour')",[offer,transfer,{ciphertext:'synthetic placeholder; not a usable token'}]);
    await source.query('UPDATE bridge_transfers SET current_offer_id=$2 WHERE id=$1',[transfer,offer]);
    await source.query("INSERT INTO bridge_idempotency(actor_id,operation,key_digest,request_digest,response) VALUES($1,'synthetic', $2,$3,$4)",[deploy,digest(randomUUID()),digest('{}'),{claim_generation:1}]);
    await agentTransaction(source,{token:credential.token,session},async()=>true);
    stage='dump-and-encrypted-archive';
    await mkdir(archiveDir,{recursive:true});await mkdir(keyDir,{recursive:true});await preflight();
    const dumpVersion=(await tool(join(binaries,'pg_dump.exe'),['--version'],pgEnv)).toString().trim();
    const archive=await tool(join(binaries,'pg_dump.exe'),['--no-password','--format=custom','--no-owner','--no-acl','--dbname',sourceName],pgEnv);
    const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
    const encrypted=Buffer.concat([cipher.update(archive),cipher.final()]);
    const backupPath=join(archiveDir,'synthetic.dump.aesgcm'),keyPath=join(keyDir,`${runId}.json`);
    await writeFile(backupPath,encrypted,{flag:'wx'});
    await writeFile(keyPath,JSON.stringify({algorithm:'aes-256-gcm',key:key.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')}),{flag:'wx'});
    await preflight();
    // Restore the bytes read back from the encrypted disk archive, not the original in-memory dump.
    const saved=JSON.parse(await readFile(keyPath,'utf8'));
    const decipher=createDecipheriv('aes-256-gcm',Buffer.from(saved.key,'base64'),Buffer.from(saved.iv,'base64'));decipher.setAuthTag(Buffer.from(saved.tag,'base64'));
    const recoveredArchive=Buffer.concat([decipher.update(await readFile(backupPath)),decipher.final()]);
    assert.equal(digest(recoveredArchive.toString('base64')),digest(archive.toString('base64')));
    stage='restore-to-new-database';
    await tool(join(binaries,'pg_restore.exe'),['--no-password','--no-owner','--no-acl','--exit-on-error','--single-transaction','--dbname',restoredName],pgEnv,recoveredArchive);
    assert.deepEqual((await restored.query('SELECT name,digest FROM bridge_migrations ORDER BY name')).rows,(await source.query('SELECT name,digest FROM bridge_migrations ORDER BY name')).rows);
    assert.equal((await restored.query('SELECT body FROM bridge_messages')).rows[0].body,'Synthetic durable recovery context');
    await agentTransaction(restored,{token:credential.token,session},async()=>true);
    stage='postrestore-invalidation';
    const invalidation=await prepareGlobalRestore(restored,{confirm:'DISABLE_RESTORED_ACCESS'});
    await assert.rejects(agentTransaction(restored,{token:credential.token,session},async()=>true),error=>error instanceof BridgeError&&error.status===401);
    assert.equal((await restored.query('SELECT count(*) FROM "session"')).rows[0].count,'0');
    assert.equal((await restored.query('SELECT count(*) FROM verification')).rows[0].count,'0');
    assert.equal((await restored.query('SELECT state FROM bridge_projects')).rows[0].state,'paused');
    assert.equal((await restored.query('SELECT count(*) FROM bridge_agents WHERE session_id IS NOT NULL OR takeover_digest IS NOT NULL OR generation<>4')).rows[0].count,'0');
    assert.equal((await restored.query("SELECT count(*) FROM bridge_tasks WHERE state='needs_reconciliation'")).rows[0].count,'2');
    assert.equal((await restored.query('SELECT cancellation_requested FROM bridge_tasks WHERE id=$1',[cancel])).rows[0].cancellation_requested,true);
    assert.equal((await restored.query('SELECT state FROM bridge_tasks WHERE id=$1',[completed])).rows[0].state,'completed');
    assert.deepEqual((await restored.query('SELECT state,cleanup_state FROM bridge_transfers')).rows[0],{state:'expired',cleanup_state:'unknown'});
    assert.equal((await restored.query("SELECT count(*) FROM bridge_offers WHERE envelope IS NULL AND revoked_at IS NOT NULL AND expires_at<=now() AND cleanup_state='unknown'")).rows[0].count,'1');
    assert.deepEqual((await restored.query('SELECT retired,response FROM bridge_idempotency')).rows[0],{retired:true,response:{}});
    stage='claims-reconciliation';
    // Simulate deliberate owner reprovisioning only in the isolated restored fixture. Project stays paused.
    const replacement=newCredential(),replacementSession=randomUUID();
    await restored.query("INSERT INTO bridge_credentials(id,agent_id,digest,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",[replacement.id,deploy,replacement.digest]);
    await restored.query('UPDATE bridge_agents SET session_id=$2 WHERE id=$1',[deploy,replacementSession]);
    const access={token:replacement.token,session:replacementSession};
    await assert.rejects(agentTransaction(restored,access,(client,who)=>taskMutation(client,who,claim,'renew',{claim_generation:1})),error=>error instanceof BridgeError&&error.code==='CLAIM_STALE');
    await assert.rejects(agentTransaction(restored,access,(client,who)=>taskMutation(client,who,claim,'reconcile',{outcome:'continue',evidence:'Synthetic local stop confirmed',local_operation_stopped:true})),error=>error instanceof BridgeError&&error.code==='PROJECT_PAUSED');
    const reconciled=await agentTransaction(restored,access,(client,who)=>taskMutation(client,who,claim,'reconcile',{outcome:'completed',evidence:'Synthetic fixture checkpoint verified; no local command ran.'}));
    assert.equal(reconciled.task.state,'completed');
    const cancelled=await agentTransaction(restored,access,(client,who)=>taskMutation(client,who,cancel,'reconcile',{outcome:'cancelled',evidence:'Synthetic fixture confirms no local operation exists.',local_operation_stopped:true}));
    assert.equal(cancelled.task.state,'cancelled');
    // Finish with restored access disabled, including the temporary drill-only replacement credential.
    await prepareGlobalRestore(restored,{confirm:'DISABLE_RESTORED_ACCESS'});
    await agentTransaction(source,{token:credential.token,session},async()=>true);
    assert.equal((await source.query('SELECT state FROM bridge_projects')).rows[0].state,'active');
    assert.equal((await source.query('SELECT state FROM bridge_tasks WHERE id=$1',[claim])).rows[0].state,'claimed');
    const sourceFiles=[];
    for(const name of ['scripts/restore-drill.ts','scripts/maintain.ts','src/lib/agent-auth.ts','src/lib/tasks.ts'])sourceFiles.push({name,sha256:createHash('sha256').update(await readFile(join(root,name))).digest('hex')});
    let revision:string|null=null;try{revision=(await tool('git.exe',['-C',root,'rev-parse','--verify','HEAD'],process.env)).toString().trim();}catch{/* An initial uncommitted repository has no revision; file hashes remain authoritative. */}
    const report={run_id:runId,completed_at:new Date().toISOString(),source_revision:revision,source_files:sourceFiles,cluster:{host:identity.host,port:identity.port,data_path:identity.path,server_version:identity.version},pg_dump:dumpVersion,source_database:sourceName,restored_database:restoredName,backup_path:backupPath,key_path:keyPath,archive_bytes:archive.length,encrypted_bytes:encrypted.length,archive_sha256:createHash('sha256').update(archive).digest('hex'),encrypted_sha256:createHash('sha256').update(encrypted).digest('hex'),migrations,invalidation,checks:{archive_authenticated_decryption:true,migrations_and_message_restored:true,old_key_accepted_before_invalidation:true,old_key_rejected_after_invalidation:true,human_sessions_and_challenges_removed:true,agent_sessions_and_takeovers_fenced:true,project_paused:true,unfinished_claims_require_reconciliation:true,cancellation_preserved:true,terminal_task_preserved:true,offers_expired_secrets_purged_cleanup_unknown:true,idempotency_responses_retired:true,stale_renew_rejected:true,paused_continue_rejected:true,evidence_completion_and_safe_cancellation_recorded:true,restored_access_disabled_again:true,synthetic_source_unchanged:true},scope:'Synthetic records only. No app served the isolated databases. No dev/test connection, database overwrite, service operation, public ingress or file endpoint cleanup performed.'};
    await writeFile(join(archiveDir,'evidence.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }finally{await Promise.allSettled([admin.end(),source?.end(),restored?.end()]);}
}
main().catch(error=>{console.error(`Restore drill failed at ${stage}${stage==='preflight'&&error instanceof Error?`: ${error.message}`:''}. No credentials or database records printed. Any newly created drill databases/archive remain isolated for inspection.`);process.exitCode=1;});
