import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
const run=promisify(execFile);
const root=path.resolve('.local');
const binary=process.env.AGE_BINARY??path.join(root,'tools/age-1.3.2/age/age.exe');
const keygen=process.env.AGE_KEYGEN_BINARY??path.join(root,'tools/age-1.3.2/age/age-keygen.exe');
let present=true;try{await access(binary);await access(keygen);}catch{present=false;}
describe.skipIf(!present)('vetted age recipient encryption',()=> {
  it('F08 only the intended recipient decrypts exact synthetic bytes',async()=> {
    await mkdir(root,{recursive:true,mode:0o700});
    const stage=await mkdtemp(path.join(root,'age-test-'));
    try {
      const intended=path.join(stage,'intended.key');const unrelated=path.join(stage,'unrelated.key');
      await run(keygen,['-o',intended],{windowsHide:true});await run(keygen,['-o',unrelated],{windowsHide:true});
      const recipient=(await run(keygen,['-y',intended],{windowsHide:true})).stdout.trim();
      expect(recipient).toMatch(/^age1/);
      const payload=randomBytes(65537);const source=path.join(stage,'source.bin');const encrypted=path.join(stage,'payload.age');const restored=path.join(stage,'restored.bin');
      await writeFile(source,payload);
      await run(binary,['-r',recipient,'-o',encrypted,source],{windowsHide:true});
      expect((await readFile(encrypted)).equals(payload)).toBe(false);
      await expect(run(binary,['-d','-i',unrelated,'-o',path.join(stage,'wrong.bin'),encrypted],{windowsHide:true})).rejects.toMatchObject({code:1});
      await run(binary,['-d','-i',intended,'-o',restored,encrypted],{windowsHide:true});
      expect((await readFile(restored)).equals(payload)).toBe(true);
    } finally {await rm(stage,{recursive:true,force:true});}
  });
});
