import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
const run=promisify(execFile);
it('F09 rejects wrong digests, escaping paths, links and expanded-size limits before extraction',async()=> {
  const script=String.raw`
import importlib.util, tempfile, zipfile, hashlib, pathlib, stat, json
spec=importlib.util.spec_from_file_location('check','helpers/check_archive.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(dir='.local',prefix='archive-test-') as stage:
 p=pathlib.Path(stage)/'test.zip'
 cases=[('app/release.txt',False,100,True),('../escape',False,100,False),('/absolute',False,100,False),('C:/escape',False,100,False),('link',True,100,False),('normal',False,1,False),('CON.txt',False,100,False)]
 for name,link,limit,expected in cases:
  with zipfile.ZipFile(p,'w') as z:
   info=zipfile.ZipInfo(name)
   if link: info.external_attr=(stat.S_IFLNK|0o777)<<16
   z.writestr(info,b'payload')
  digest=hashlib.sha256(p.read_bytes()).hexdigest()
  try: m.check_archive(p,digest,limit); actual=True
  except ValueError: actual=False
  assert actual==expected
 with zipfile.ZipFile(p,'w') as z: z.writestr('safe.txt',b'original')
 digest=hashlib.sha256(p.read_bytes()).hexdigest()
 original_inspect=m.inspect_snapshot
 def replace_then_inspect(snapshot,expected,limit):
  with zipfile.ZipFile(p,'w') as z: z.writestr('../escape',b'replacement')
  return original_inspect(snapshot,expected,limit)
 m.inspect_snapshot=replace_then_inspect
 assert m.check_archive(p,digest)['sha256']==digest
 m.inspect_snapshot=original_inspect
 try: m.check_archive(p,'0'*64); raise AssertionError('wrong digest accepted')
 except ValueError: pass
print(json.dumps({'passed':True,'cases':9}))
`;
  const result=await run('python',['-B','-c',script],{windowsHide:true,timeout:10000});
  expect(JSON.parse(result.stdout)).toEqual({passed:true,cases:9});
});
