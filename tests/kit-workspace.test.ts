import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chooseWorkspace, codexExecutable } from '../scripts/kit-workspace.mjs';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'oab-workspace-'));roots.push(root);
  const kit=join(root,'private kit'),project=join(root,'existing project');
  await mkdir(join(kit,'workspace'),{recursive:true});await mkdir(project);
  await writeFile(join(project,'AGENTS.md'),'Existing project rules');
  return {kit,project,config:{role:'development',promptWorkingDirectory:true,cwd:'workspace',statePath:'state/session.json'}};
}
describe('role-specific kit working directories',()=>{
  it('asks deployment agents for their project folder by default and offers it again on relaunch',async()=>{
    const {kit,project,config}=await fixture();
    const deployment={...config,role:'deployment',promptWorkingDirectory:undefined};
    const prompt=vi.fn().mockResolvedValue(project);
    expect(await chooseWorkspace(deployment,kit,{prompt})).toBe(project);
    expect(prompt).toHaveBeenCalledWith(undefined);
    const again=vi.fn().mockResolvedValue('');
    expect(await chooseWorkspace(deployment,kit,{prompt:again})).toBe(project);
    expect(again).toHaveBeenCalledWith(project);
  });
  it('asks for and remembers a developer directory without replacing project instructions',async()=>{
    const {kit,project,config}=await fixture();
    const prompt=vi.fn().mockResolvedValue(project);
    expect(await chooseWorkspace(config,kit,{prompt})).toBe(project);
    expect(prompt).toHaveBeenCalledWith(undefined);
    expect(await chooseWorkspace(config,kit)).toBe(project);
    expect(await readFile(join(project,'AGENTS.md'),'utf8')).toBe('Existing project rules');
    expect(JSON.parse(await readFile(join(kit,'state/workspace.json'),'utf8'))).toEqual({cwd:project});
  });
  it('requires an explicit existing directory when no terminal or saved choice is available',async()=>{
    const {kit,project,config}=await fixture();
    await expect(chooseWorkspace(config,kit)).rejects.toThrow('Choose a project directory');
    await expect(chooseWorkspace(config,kit,{requested:'relative/path'})).rejects.toThrow('absolute');
    await expect(chooseWorkspace(config,kit,{requested:join(project,'missing')})).rejects.toThrow();
    await expect(chooseWorkspace(config,kit,{requested:join(project,'AGENTS.md')})).rejects.toThrow('not a directory');
  });
  it('keeps recovery state bound to its original project',async()=>{
    const {kit,project,config}=await fixture();
    await chooseWorkspace(config,kit,{requested:project});
    await writeFile(join(kit,'state/session.json'),JSON.stringify({cwd:project,job:{phase:'dispatching'}}));
    await expect(chooseWorkspace(config,kit,{requested:join(kit,'workspace')})).rejects.toThrow('recovery state');
    expect(await chooseWorkspace(config,kit,{requested:project})).toBe(project);
    expect(JSON.parse(await readFile(join(kit,'state/workspace.json'),'utf8')).cwd).toBe(project);
  });
  it('keeps deployment work in its configured folder without prompting',async()=>{
    const {kit,project,config}=await fixture(),prompt=vi.fn();
    expect(await chooseWorkspace({...config,role:'deployment',promptWorkingDirectory:false},kit,{prompt})).toBe(join(kit,'workspace'));
    expect(prompt).not.toHaveBeenCalled();
    await expect(chooseWorkspace({...config,promptWorkingDirectory:false},kit,{requested:project})).rejects.toThrow('configured working directory');
  });
  it('resolves the Unix Codex executable from PATH',async()=>{
    const {kit}=await fixture(),executable=join(kit,'codex');
    await writeFile(executable,'#!/bin/sh\nexit 0\n');await chmod(executable,0o700);
    expect(await codexExecutable('linux',kit)).toBe(executable);
    await expect(codexExecutable('linux','.:')).rejects.toThrow('PATH');
  });
});
