import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type Manifest = {
  version: string; transfer_id: string; mode: 'upload' | 'download'; filename: string;
  size: number; sha256: string; parts: { index: number; offset: number; size: number; sha256: string }[];
};
type Running = { process: ChildProcessWithoutNullStreams; port: number; root: string; token: string; output: () => string };
type StartupFailure = { failure: Record<string, unknown>; root: string; token: string; output: () => string };
const processes: ChildProcessWithoutNullStreams[] = [];
const directories: string[] = [];
const python = process.platform === 'win32' ? 'python' : 'python3';
const script = path.resolve('helpers/transfer_server.py');
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const chunks = [Buffer.from('Synthetic first part\n'), Buffer.from('Synthetic return package\x00\x01\x02')];

function manifest(mode: 'upload' | 'download' = 'upload'): Manifest {
  let offset = 0;
  return {
    version: '1', transfer_id: 'synthetic-proof', mode, filename: 'sample.bin',
    size: Buffer.concat(chunks).length, sha256: hash(Buffer.concat(chunks)),
    parts: chunks.map((chunk, index) => {
      const part = { index, offset, size: chunk.length, sha256: hash(chunk) };
      offset += chunk.length;
      return part;
    }),
  };
}

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-agent-bridge-transfer-test-'));
  directories.push(root);
  return root;
}

async function start(value = manifest(), options: { root?: string; ttl?: number; extra?: string[]; expectedFailure?: boolean } = {}): Promise<Running | StartupFailure> {
  const root = options.root ?? await tempRoot();
  const manifestPath = path.join(root, 'test-manifest.json');
  await writeFile(manifestPath, JSON.stringify(value));
  const token = randomBytes(32).toString('base64url');
  const child = spawn(python, ['-B', script, '--root', root, '--manifest', manifestPath, '--port', '0', '--ttl', String(options.ttl ?? 30), ...(options.extra ?? [])], {
    shell: false, windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', OPEN_AGENT_BRIDGE_TRANSFER_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  processes.push(child);
  let output = '';
  const first = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('transfer helper startup timeout')); }, 5000);
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      stdout += data.toString();
      if (stdout.includes('\n')) {
        clearTimeout(timeout);
        try { resolve(JSON.parse(stdout.split('\n')[0])); } catch { reject(new Error('helper did not produce JSON')); }
      }
    });
    child.on('exit', () => {
      if (!stdout.includes('\n')) { clearTimeout(timeout); reject(new Error('helper exited without JSON')); }
    });
  });
  if (options.expectedFailure) return { failure: first, root, token, output: () => output };
  if (first.event !== 'ready' || typeof first.port !== 'number') throw new Error(`helper startup failed: ${first.code}`);
  return { process: child, port: first.port, root, token, output: () => output } satisfies Running;
}

async function running(value = manifest(), options: Parameters<typeof start>[1] = {}): Promise<Running> {
  const result = await start(value, options);
  if (!('process' in result)) throw new Error('expected running helper');
  return result;
}

function request(server: Running, method: string, route: string, body?: Buffer, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.port, method, path: route,
      headers: { Authorization: `Bearer ${server.token}`, ...(body ? { 'Content-Length': String(body.length) } : {}), ...headers },
    }, (res) => {
      const data: Buffer[] = [];
      res.on('data', (chunk: Buffer) => data.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(data), headers: res.headers }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill();
  });
}

afterEach(async () => {
  await Promise.all(processes.splice(0).map(stop));
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('temporary transfer endpoint', () => {
  it('downloads the exact file and independently verified parts without directory access', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'sample.bin'), Buffer.concat(chunks));
    const server = await running(manifest('download'), { root });
    const full = await request(server, 'GET', '/v1/file');
    expect(full.status).toBe(200);
    expect(full.body).toEqual(Buffer.concat(chunks));
    expect(full.headers['x-content-sha256']).toBe(hash(full.body));
    for (const [index, chunk] of chunks.entries()) {
      expect((await request(server, 'GET', `/v1/parts/${index}`)).body).toEqual(chunk);
    }
    expect((await request(server, 'GET', '/')).status).toBe(404);
    expect((await request(server, 'GET', '/v1/file', undefined, { Range: 'bytes=0-2' })).status).toBe(416);
  });

  it('accepts upload parts and publishes only after the complete receiving hash is verified', async () => {
    const server = await running();
    expect((await request(server, 'POST', '/v1/finalize')).status).toBe(409);
    for (const [index, chunk] of chunks.entries()) {
      expect((await request(server, 'PUT', `/v1/parts/${index}`, chunk)).status).toBe(200);
    }
    expect((await readdir(server.root)).includes('sample.bin')).toBe(false);
    const result = await request(server, 'POST', '/v1/finalize');
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body.toString())).toMatchObject({ verified: true, sha256: manifest().sha256 });
    expect(await readFile(path.join(server.root, 'sample.bin'))).toEqual(Buffer.concat(chunks));
    expect((await request(server, 'POST', '/v1/finalize')).status).toBe(200);
    expect((await request(server, 'PUT', '/v1/parts/0', chunks[0])).status).toBe(409);
    expect(server.output()).not.toContain(server.token);
    expect(server.output()).not.toContain(chunks[0].toString());
  });

  it('rejects unauthorized requests, traversal, encoded separators and methods outside the fixed routes', async () => {
    const server = await running();
    expect((await request(server, 'PUT', '/v1/parts/0', chunks[0], { Authorization: 'Bearer wrong' })).status).toBe(401);
    for (const route of ['/../secret', '/v1/%2e%2e/secret', '/v1/parts%2f0', '/v1/parts/0?token=bad', '/v1/parts\\0']) {
      const response = await request(server, 'GET', route);
      expect(response.status).toBe(400);
      expect(response.headers.location).toBeUndefined();
    }
    expect((await request(server, 'GET', '/v1/file')).status).toBe(404);
    expect(JSON.parse((await request(server, 'GET', '/v1/status')).body.toString()).committed_parts).toEqual([]);
  });

  it('rejects oversized and corrupt parts without retaining partial data', async () => {
    const server = await running();
    expect((await request(server, 'PUT', '/v1/parts/0', Buffer.alloc(chunks[0].length + 1))).status).toBe(413);
    expect((await request(server, 'PUT', '/v1/parts/0', Buffer.alloc(chunks[0].length))).status).toBe(422);
    const staging = path.join(server.root, '.open-agent-bridge-transfer-synthetic-proof');
    expect((await readdir(staging)).sort()).toEqual(['.lock', 'manifest.json']);
  });

  it('makes matching part retries idempotent and rejects conflicting retries', async () => {
    const server = await running();
    expect((await request(server, 'PUT', '/v1/parts/0', chunks[0])).status).toBe(200);
    const duplicate = await request(server, 'PUT', '/v1/parts/0', chunks[0]);
    expect(JSON.parse(duplicate.body.toString()).duplicate).toBe(true);
    expect((await request(server, 'PUT', '/v1/parts/0', Buffer.alloc(chunks[0].length))).status).toBe(409);
    expect(JSON.parse((await request(server, 'GET', '/v1/status')).body.toString()).committed_parts).toEqual([0]);
  });

  it('resumes committed parts across an explicit restart with a fresh token', async () => {
    const first = await running();
    await request(first, 'PUT', '/v1/parts/0', chunks[0]);
    await stop(first.process);
    const second = await running(manifest(), { root: first.root });
    expect(JSON.parse((await request(second, 'GET', '/v1/status')).body.toString()).committed_parts).toEqual([0]);
    expect((await request(second, 'GET', '/v1/status', undefined, { Authorization: `Bearer ${first.token}` })).status).toBe(401);
    await request(second, 'PUT', '/v1/parts/1', chunks[1]);
    expect((await request(second, 'POST', '/v1/finalize')).status).toBe(200);
  });

  it('discards an interrupted temporary part on restart while retaining verified parts', async () => {
    const first = await running();
    await request(first, 'PUT', '/v1/parts/0', chunks[0]);
    const partial = http.request({ hostname: '127.0.0.1', port: first.port, method: 'PUT', path: '/v1/parts/1',
      headers: { Authorization: `Bearer ${first.token}`, 'Content-Length': String(chunks[1].length) } });
    partial.on('error', () => undefined);
    partial.write(chunks[1].subarray(0, 2));
    const staging = path.join(first.root, '.open-agent-bridge-transfer-synthetic-proof');
    let temporaryFound = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await readdir(staging)).some((name) => name.startsWith('tmp-'))) { temporaryFound = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(temporaryFound).toBe(true);
    await stop(first.process);
    partial.destroy();
    const second = await running(manifest(), { root: first.root });
    expect((await readdir(staging)).some((name) => name.startsWith('tmp-'))).toBe(false);
    expect(JSON.parse((await request(second, 'GET', '/v1/status')).body.toString()).committed_parts).toEqual([0]);
    await request(second, 'PUT', '/v1/parts/1', chunks[1]);
    expect((await request(second, 'POST', '/v1/finalize')).status).toBe(200);
  });

  it('prevents two active upload helpers from sharing the same staging area', async () => {
    const first = await running();
    const second = await start(manifest(), { root: first.root, expectedFailure: true });
    expect('failure' in second && second.failure.code).toBe('transfer_already_running');
    expect((await request(first, 'PUT', '/v1/parts/0', chunks[0])).status).toBe(200);
  });

  it('rejects a different manifest for existing partial work', async () => {
    const first = await running();
    await request(first, 'PUT', '/v1/parts/0', chunks[0]);
    await stop(first.process);
    const changed = manifest();
    changed.sha256 = '0'.repeat(64);
    const result = await start(changed, { root: first.root, expectedFailure: true });
    expect('failure' in result && result.failure.code).toBe('resume_manifest_conflict');
  });

  it('rejects an existing mismatched destination and preserves its bytes', async () => {
    const root = await tempRoot();
    const original = Buffer.from('Existing user data');
    await writeFile(path.join(root, 'sample.bin'), original);
    const result = await start(manifest(), { root, expectedFailure: true });
    expect('failure' in result && result.failure.code).toBe('destination_or_source_digest_mismatch');
    expect(await readFile(path.join(root, 'sample.bin'))).toEqual(original);
  });

  it('cannot overwrite a destination created after startup', async () => {
    const server = await running();
    for (const [index, chunk] of chunks.entries()) await request(server, 'PUT', `/v1/parts/${index}`, chunk);
    const original = Buffer.from('Created concurrently');
    await writeFile(path.join(server.root, 'sample.bin'), original);
    expect((await request(server, 'POST', '/v1/finalize')).status).toBe(409);
    expect(await readFile(path.join(server.root, 'sample.bin'))).toEqual(original);
  });

  it('does not publish an upload whose assembled whole hash differs from its manifest', async () => {
    const value = manifest();
    value.sha256 = '0'.repeat(64);
    const server = await running(value);
    for (const [index, chunk] of chunks.entries()) await request(server, 'PUT', `/v1/parts/${index}`, chunk);
    const response = await request(server, 'POST', '/v1/finalize');
    expect(response.status).toBe(422);
    expect(JSON.parse(response.body.toString()).error).toBe('whole_file_digest_mismatch');
    expect((await readdir(server.root)).includes('sample.bin')).toBe(false);
  });

  it('rejects unsafe filenames, excessive manifest size and noncontiguous parts before listening', async () => {
    for (const filename of ['../escape.bin', 'NUL.txt', 'bad:name', 'trailing.']) {
      const value = manifest();
      value.filename = filename;
      const result = await start(value, { expectedFailure: true });
      expect('failure' in result && result.failure.code).toBe('invalid_mode_or_filename');
    }
    const tooLarge = await start(manifest(), { extra: ['--max-bytes', '1'], expectedFailure: true });
    expect('failure' in tooLarge && tooLarge.failure.code).toBe('file_size_limit');
    const gap = manifest();
    gap.parts[1].offset += 1;
    const invalid = await start(gap, { expectedFailure: true });
    expect('failure' in invalid && invalid.failure.code).toBe('invalid_part_layout');
  });

  it('rejects a junction or symlink ancestor of the transfer root', async () => {
    const outer = await tempRoot();
    const target = path.join(outer, 'actual');
    const linked = path.join(outer, 'linked');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await start(manifest(), { root: linked, expectedFailure: true });
    expect('failure' in result && result.failure.code).toBe('linked_path_rejected');
  });

  it('rechecks the source identity before download', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'sample.bin'), Buffer.concat(chunks));
    const server = await running(manifest('download'), { root });
    await writeFile(path.join(root, 'sample.bin'), Buffer.from('Changed source'));
    expect((await request(server, 'GET', '/v1/file')).status).toBe(409);
  });

  it('stops accepting connections after its fixed deadline', async () => {
    const server = await running(manifest(), { ttl: 1 });
    expect((await request(server, 'GET', '/v1/status')).status).toBe(200);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('helper did not expire')), 3000);
      server.process.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await expect(request(server, 'GET', '/v1/status')).rejects.toThrow();
  });
});
