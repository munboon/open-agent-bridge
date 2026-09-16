import { access, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

async function optionalJSON(path) {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}
export async function chooseWorkspace(config, kitRoot, {requested, prompt} = {}) {
  const statePath=resolve(kitRoot,config.statePath??'state/session.json');
  const preferences=join(dirname(statePath),'workspace.json');
  if(config.promptWorkingDirectory===false) {
    if(requested)throw Error('This kit uses its configured working directory.');
    const cwd=await realpath(resolve(kitRoot,config.cwd??'workspace'));
    if(!(await stat(cwd)).isDirectory())throw Error('The configured workspace is not a directory.');
    return cwd;
  }
  const saved=await optionalJSON(preferences);
  let selected=requested;
  if(!selected && prompt)selected=(await prompt(saved?.cwd)).trim() || saved?.cwd;
  if(!selected)selected=saved?.cwd;
  if(!selected)throw Error('Choose a project directory with --cwd or launch in a visible terminal.');
  if(selected==='~'||selected.startsWith('~/'))selected=join(homedir(),selected.slice(2));
  if(!isAbsolute(selected))throw Error('Enter an absolute project directory.');
  const cwd=await realpath(selected);
  if(!(await stat(cwd)).isDirectory())throw Error('The selected working path is not a directory.');
  const recovery=await optionalJSON(statePath);
  if(recovery && (recovery.cwd??saved?.cwd)!==cwd)throw Error('This kit has recovery state for a different directory. Use the original directory or a separate kit folder; do not delete recovery state.');
  await mkdir(dirname(preferences),{recursive:true});
  await writeFile(preferences,JSON.stringify({cwd},null,2)+'\n',{mode:0o600});
  return cwd;
}

export async function codexExecutable(platform=process.platform, searchPath=process.env.PATH??'') {
  if(platform==='win32') {
    let executable;
    try {executable=execFileSync('where.exe',['codex.exe'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim().split(/\r?\n/)[0];}
    catch {
      const wrapper=execFileSync('where.exe',['codex.cmd'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim().split(/\r?\n/)[0];
      executable=resolve(dirname(wrapper),'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
    }
    await access(executable);return executable;
  }
  for(const directory of searchPath.split(delimiter).filter(isAbsolute)) {
    const executable=join(directory,'codex');
    try {await access(executable,constants.X_OK);if((await stat(executable)).isFile())return executable;} catch {}
  }
  throw Error('Install and sign in to Codex CLI, and make codex available on PATH.');
}
