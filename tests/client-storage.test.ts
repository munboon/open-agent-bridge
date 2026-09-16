import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
vi.mock('node:os',async importOriginal=>({...await importOriginal<typeof import('node:os')>(),homedir:vi.fn()}));
import {storage} from '../scripts/bridge-client.mjs';
let home:string;
const config={origin:'https://bridge.example.test',agentId:randomUUID()};
const identity=createHash('sha256').update(config.origin+'\n'+config.agentId).digest('hex');
beforeEach(async()=>{home=await mkdtemp(join(tmpdir(),'oab-storage-'));vi.mocked(homedir).mockReturnValue(home);});
afterEach(async()=>{await rm(home,{recursive:true,force:true});vi.clearAllMocks();});
it.skipIf(process.platform==='win32')('creates private storage under the standalone product name',async()=>{
 const root=await storage(config);
 expect(root).toBe(join(home,'.config','open-agent-bridge',identity));
 expect((await stat(root)).mode&0o077).toBe(0);
});
it.skipIf(process.platform==='win32')('keeps existing preview identity keys in place',async()=>{
 const previous=join(home,'.config','open-agent-bridge-bridge',identity);
 await mkdir(previous,{recursive:true,mode:0o700});await writeFile(join(previous,'identity.json'),'synthetic-key-marker',{mode:0o600});
 expect(await storage(config)).toBe(previous);
 expect(await readFile(join(previous,'identity.json'),'utf8')).toBe('synthetic-key-marker');
 await expect(stat(join(home,'.config','open-agent-bridge',identity))).rejects.toMatchObject({code:'ENOENT'});
});
it.skipIf(process.platform==='win32')('rejects a symlink at the preview key location instead of creating a new identity',async()=>{
 const base=join(home,'.config','open-agent-bridge-bridge'),target=join(home,'target');
 await mkdir(base,{recursive:true});await mkdir(target,{mode:0o700});await symlink(target,join(base,identity));
 await expect(storage(config)).rejects.toThrow('Private storage must not use symbolic links');
});
