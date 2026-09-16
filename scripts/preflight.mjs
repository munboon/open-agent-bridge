import { spawn } from 'node:child_process';
import { access, lstat, readdir, realpath } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isWindows = process.platform === 'win32';
const timeoutMs = 8000;
const outputLimit = 16384;

// Pure policy helper: lexical and resolved paths must both be checked.
export function assessPathEvidence(entries, platform = process.platform) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const normalize = (value) => {
    const normalized = api.normalize(value).replace(/[\\/]+$/, '');
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const findings = [];
  for (const entry of entries) {
    if (!entry.path || !entry.resolved || entry.error || !api.isAbsolute(entry.path) || !api.isAbsolute(entry.resolved)) {
      findings.push({ code: 'path_unverified', path: entry.path ?? null });
      continue;
    }
    if ([entry.path, entry.resolved].some((value) => value.split(/[\\/]/).some((part) => /^onedrive(?:$|[ -])/i.test(part)))) {
      findings.push({ code: 'onedrive_path', path: entry.path });
    }
    if (entry.reparse || entry.symbolic || normalize(entry.path) !== normalize(entry.resolved)) {
      findings.push({ code: 'linked_or_redirected_path', path: entry.path });
    }
  }
  if (entries.length === 0) findings.push({ code: 'path_unverified', path: null });
  return { safe: findings.length === 0, findings };
}

// Keep unknown execution failures distinct from a missing executable.
/** @param {{found: boolean, timedOut?: boolean, outputExceeded?: boolean, error?: boolean, exitCode?: number | null, version?: string}} evidence */
export function classifyCapability({ found, timedOut, outputExceeded, error, exitCode, version }) {
  if (!found) return { status: 'missing', reason: 'not_on_path' };
  if (timedOut) return { status: 'unknown', reason: 'version_probe_timeout' };
  if (outputExceeded) return { status: 'unknown', reason: 'version_output_limit' };
  if (error) return { status: 'unknown', reason: 'version_probe_failed' };
  if (exitCode !== 0) return { status: 'unknown', reason: 'version_probe_nonzero' };
  if (!version) return { status: 'unknown', reason: 'version_not_recognized' };
  return { status: 'available', version };
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let done = false;
    let timer;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };
    const terminate = () => {
      if (!isWindows || !child.pid) { child.kill(); return; }
      // A .cmd shim may have spawned Node. Terminate only this probe's tree,
      // keeping the parent alive until taskkill can identify its descendants.
      const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
      const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
        shell: false, windowsHide: true, stdio: 'ignore',
      });
      const cleanupTimer = setTimeout(() => { killer.kill(); child.kill(); }, 1500);
      killer.once('error', () => { clearTimeout(cleanupTimer); child.kill(); });
      killer.once('close', () => { clearTimeout(cleanupTimer); child.kill(); });
    };
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    } catch {
      finish({ error: true });
      return;
    }
    const capture = (stream) => (chunk) => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > outputLimit) {
        terminate();
        finish({ outputExceeded: true });
        return;
      }
      if (stream === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.on('error', () => finish({ error: true }));
    child.on('close', (exitCode) => finish({ exitCode }));
    timer = setTimeout(() => {
      terminate();
      finish({ timedOut: true });
    }, timeoutMs);
  });
}

async function findExecutable(names, extraDirectories = []) {
  // Do not resolve from the working directory, empty PATH elements, or relative PATH entries.
  const directories = [...(process.env.PATH ?? '').split(path.delimiter), ...extraDirectories]
    .map((part) => part.replace(/^"|"$/g, '')).filter((part) => path.isAbsolute(part));
  for (const name of names) {
    for (const directory of directories) {
      const candidate = path.join(directory, name);
      try {
        const info = await lstat(candidate);
        if (!info.isFile() && !info.isSymbolicLink()) continue;
        await access(candidate);
        return candidate;
      } catch { /* Try the next PATH entry. */ }
    }
  }
  return null;
}

async function inspectProject(projectPath, powershell) {
  const entries = [];
  let current = path.resolve(projectPath);
  while (true) {
    try {
      const [resolved, info] = await Promise.all([realpath(current), lstat(current)]);
      entries.push({ path: current, resolved, symbolic: info.isSymbolicLink() });
    } catch {
      entries.push({ path: current, error: true });
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Windows junctions normally differ under realpath. Attributes additionally catch
  // reparse points whose target happens to resolve to the same spelling.
  if (isWindows) {
    if (!powershell) entries.push({ path: path.resolve(projectPath), error: true });
    else {
      const script = "$ErrorActionPreference='Stop'; $taskPath=$env:OPEN_AGENT_BRIDGE_PREFLIGHT_PROJECT; $items=@(); while ($true) { $item=Get-Item -Force -LiteralPath $taskPath; $items+=@{path=$taskPath; reparse=[bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)}; $parent=[IO.Directory]::GetParent($taskPath); if ($null -eq $parent) { break }; $taskPath=$parent.FullName }; ConvertTo-Json -Compress -InputObject @($items)";
      const result = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, OPEN_AGENT_BRIDGE_PREFLIGHT_PROJECT: path.resolve(projectPath) },
      });
      try {
        if (result.exitCode !== 0) throw new Error('unverified');
        const attributes = JSON.parse(result.stdout);
        if (!Array.isArray(attributes) || attributes.length !== entries.length) throw new Error('unverified');
        for (const entry of entries) {
          const attribute = attributes.find((item) => typeof item.path === 'string' && item.path.toLowerCase() === entry.path.toLowerCase());
          if (!attribute || typeof attribute.reparse !== 'boolean') entry.error = true;
          else entry.reparse = attribute.reparse;
        }
      } catch { entries.push({ path: path.resolve(projectPath), error: true }); }
    }
  }
  return { requested: path.resolve(projectPath), resolved: entries[0]?.resolved ?? null, ...assessPathEvidence(entries) };
}

const capabilities = [
  { name: 'node', names: ['node.exe'], unix: ['node'], pattern: /^v(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/m },
  { name: 'pnpm', names: ['pnpm.exe', 'pnpm.cmd'], unix: ['pnpm'], pattern: /^(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/m },
  { name: 'git', names: ['git.exe'], unix: ['git'], pattern: /^git version ([\d.]+(?:[\w.-]*))$/m },
  { name: 'codex', names: ['codex.exe', 'codex.cmd'], unix: ['codex'], pattern: /^codex(?:-cli)? (\d+\.\d+\.\d+(?:-[\w.-]+)?)$/m },
  { name: 'cloudflared', names: ['cloudflared.exe'], unix: ['cloudflared'], pattern: /^cloudflared version (\d+\.\d+\.\d+)/m },
  { name: 'powershell', names: ['pwsh.exe', 'powershell.exe'], unix: ['pwsh'], pattern: /^(\d+\.\d+(?:\.\d+){0,2}(?:-[\w.-]+)?)$/m, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'] },
  { name: 'python', names: ['python.exe', 'python3.exe'], unix: ['python3', 'python'], pattern: /^Python (\d+\.\d+\.\d+)/m },
  { name: 'age', names: ['age.exe'], unix: ['age'], pattern: /^v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/m },
  { name: 'postgres', names: ['postgres.exe'], unix: ['postgres'], pattern: /^postgres \(PostgreSQL\) (\d+(?:\.\d+){1,2})/m },
  { name: 'initdb', names: ['initdb.exe'], unix: ['initdb'], pattern: /^initdb \(PostgreSQL\) (\d+(?:\.\d+){1,2})/m },
  { name: 'pg_ctl', names: ['pg_ctl.exe'], unix: ['pg_ctl'], pattern: /^pg_ctl \(PostgreSQL\) (\d+(?:\.\d+){1,2})/m },
  { name: 'psql', names: ['psql.exe'], unix: ['psql'], pattern: /^psql \(PostgreSQL\) (\d+(?:\.\d+){1,2})/m },
];

async function probeCapability(capability) {
  const extraDirectories = [];
  if (isWindows && ['postgres', 'initdb', 'pg_ctl', 'psql'].includes(capability.name)) {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      const installationRoot = path.join(root, 'PostgreSQL');
      try {
        const versions = (await readdir(installationRoot, { withFileTypes: true }))
          .filter((item) => item.isDirectory() && /^\d+(?:\.\d+)?$/.test(item.name))
          .sort((a, b) => Number(b.name) - Number(a.name)).slice(0, 32);
        extraDirectories.push(...versions.map((item) => path.join(installationRoot, item.name, 'bin')));
      } catch { /* No standard PostgreSQL installation directory. */ }
    }
  }
  const executable = await findExecutable(isWindows ? capability.names : capability.unix, extraDirectories);
  if (!executable) return { name: capability.name, ...classifyCapability({ found: false }) };
  let result;
  if (isWindows && executable.toLowerCase().endsWith('.cmd')) {
    // Only these two known --version shims are allowed. Reject cmd expansion and
    // control characters even inside a quoted path. No user-supplied arguments.
    if (!['pnpm', 'codex'].includes(capability.name) || /["%!\x00-\u001f&|<>^]/.test(executable)) {
      return { name: capability.name, status: 'unknown', reason: 'unsafe_shim_path' };
    }
    const cmd = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
    result = await run(cmd, ['/d', '/s', '/c', `""${executable}" --version"`], { windowsVerbatimArguments: true });
  } else {
    result = await run(executable, capability.args ?? ['--version']);
  }
  const version = `${result.stdout}\n${result.stderr}`.trim().match(capability.pattern)?.[1];
  // Never echo raw version output: a broken shim could print configuration/secrets.
  return { name: capability.name, ...classifyCapability({ found: true, ...result, version }) };
}

function checkPort(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (status) => { socket.destroy(); resolve({ host, status }); };
    socket.setTimeout(1000);
    socket.once('connect', () => finish('occupied'));
    socket.once('timeout', () => finish('unknown'));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED' ? 'not_listening' : 'unknown'));
    socket.connect(port, host);
  });
}

async function main() {
  const projectPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const powershell = await findExecutable(isWindows ? ['pwsh.exe', 'powershell.exe'] : ['pwsh']);
  const project = await inspectProject(projectPath, powershell);
  const report = {
    timestamp: new Date().toISOString(), platform: process.platform, project,
    capabilities: [], ports: [],
    notes: [
      'Read-only checks; no credentials, configuration contents, agents, or services are opened.',
      'Missing means not found on PATH or, for Windows PostgreSQL, its standard Program Files directories. Other installations may still exist.',
      'Version discovery does not verify provider login, networking permissions, or harness compatibility.',
      'Ports are checked by TCP connection to IPv4/IPv6 loopback, without binding. No listener does not guarantee the port can later be bound.',
      'Docker is not required. Standalone PostgreSQL provisioning is a separate step.',
    ],
  };
  if (project.safe) {
    // Sequential version probes keep process/output usage bounded.
    for (const capability of capabilities) report.capabilities.push(await probeCapability(capability));
    for (const port of [3220, 55442]) {
      const endpoints = await Promise.all(['127.0.0.1', '::1'].map((host) => checkPort(host, port)));
      const status = endpoints.some((entry) => entry.status === 'occupied') ? 'occupied'
        : endpoints.every((entry) => entry.status === 'not_listening') ? 'not_listening' : 'unknown';
      report.ports.push({ port, status, endpoints });
    }
  } else {
    report.notes.push('Capability and port checks skipped because the project path is unsafe or unverified.');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = project.safe ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), status: 'unknown', reason: 'preflight_failed' })}\n`);
    process.exitCode = 1;
  });
}
