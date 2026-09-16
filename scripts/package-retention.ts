import {readdir,lstat,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Pool} from 'pg';
import {pool,transaction} from '../src/lib/db';
import {packageRoot,chunkName} from '../src/lib/hosted-packages';
export async function purgePackages(database:Pool,packageId?:string){
 const root=await packageRoot();let removed=0;
 await transaction(database,async client=>{
  const rows=(await client.query("SELECT id,state FROM bridge_packages WHERE purged_at IS NULL AND (expires_at<=now() OR state IN ('cancelled','verified')) AND ($1::uuid IS NULL OR id=$1) ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED",[packageId??null])).rows;
  for(const row of rows){const chunks=(await client.query('SELECT part,sha256 FROM bridge_package_chunks WHERE package_id=$1',[row.id])).rows;for(const chunk of chunks){await unlink(join(root,chunkName(row.id,chunk.part,chunk.sha256))).catch(error=>{if(error.code!=='ENOENT')throw error;});removed++;}await client.query("UPDATE bridge_packages SET state=CASE WHEN state IN ('cancelled','verified') THEN state ELSE 'expired' END,purged_at=now() WHERE id=$1",[row.id]);}
  await client.query('DELETE FROM bridge_request_proofs WHERE expires_at<now()');
 });
 // Crashes or rolled-back uploads can leave unreferenced files. Keep a grace
 // period so an in-flight write cannot be mistaken for an orphan.
 if(packageId)return {removed};
 const known=new Set((await database.query('SELECT c.package_id,c.part,c.sha256 FROM bridge_package_chunks c JOIN bridge_packages p ON p.id=c.package_id WHERE p.purged_at IS NULL')).rows.map(c=>chunkName(c.package_id,c.part,c.sha256)));
 for(const name of await readdir(root)){if(!/^[0-9a-f-]{36}(?:-\d+-[0-9a-f]{64}\.part|\.tmp)$/.test(name)||known.has(name))continue;const path=join(root,name);const stat=await lstat(path);if(stat.isFile()&&stat.mtimeMs<Date.now()-3600000){await unlink(path);removed++;}}
 return {removed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)purgePackages(pool).then(result=>console.log(JSON.stringify(result))).finally(()=>pool.end());
