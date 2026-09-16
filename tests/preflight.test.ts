import { describe, expect, it } from 'vitest';
import { assessPathEvidence, classifyCapability } from '../scripts/preflight.mjs';

describe('project path safety', () => {
  it('rejects both a direct OneDrive ancestor and a link into OneDrive', () => {
    const direct = assessPathEvidence([
      { path: 'D:\\OneDrive - Company\\Projects\\Bridge', resolved: 'D:\\OneDrive - Company\\Projects\\Bridge' },
    ], 'win32');
    const indirect = assessPathEvidence([
      { path: 'D:\\Projects\\Bridge', resolved: 'D:\\OneDrive\\Bridge' },
    ], 'win32');
    expect(direct.safe).toBe(false);
    expect(indirect.findings.map((item: { code: string }) => item.code)).toContain('onedrive_path');
    expect(indirect.findings.map((item: { code: string }) => item.code)).toContain('linked_or_redirected_path');
  });

  it('rejects a reparse ancestor even when realpath has the same spelling', () => {
    expect(assessPathEvidence([
      { path: 'D:\\Projects\\Bridge', resolved: 'D:\\Projects\\Bridge' },
      { path: 'D:\\Projects', resolved: 'D:\\Projects', reparse: true },
    ], 'win32').safe).toBe(false);
  });

  it('fails closed for unreadable or missing path evidence', () => {
    expect(assessPathEvidence([], 'win32').safe).toBe(false);
    expect(assessPathEvidence([{ path: 'D:\\Projects', error: true }], 'win32').safe).toBe(false);
    expect(assessPathEvidence([{ path: 'Projects', resolved: 'Projects' }], 'win32').safe).toBe(false);
  });

  it('handles Windows case equivalence without hiding POSIX redirects', () => {
    expect(assessPathEvidence([{ path: 'D:\\Projects\\Bridge', resolved: 'd:\\projects\\bridge' }], 'win32').safe).toBe(true);
    expect(assessPathEvidence([{ path: '/Projects/Bridge', resolved: '/projects/bridge' }], 'linux').safe).toBe(false);
  });

  it('does not confuse an ordinary similarly named project with a OneDrive tree', () => {
    expect(assessPathEvidence([{ path: 'D:\\Projects\\OneDriver', resolved: 'D:\\Projects\\OneDriver' }], 'win32').safe).toBe(true);
  });
});

describe('capability evidence', () => {
  it('never reports an unsuccessful probe as available even if output contains a version', () => {
    for (const failure of [{ timedOut: true }, { outputExceeded: true }, { error: true }, { exitCode: 1 }]) {
      expect(classifyCapability({ found: true, exitCode: 0, version: '1.2.3', ...failure }).status).toBe('unknown');
    }
  });

  it('distinguishes absent executables from unrecognized successful output', () => {
    expect(classifyCapability({ found: false }).status).toBe('missing');
    expect(classifyCapability({ found: true, exitCode: 0 }).status).toBe('unknown');
    expect(classifyCapability({ found: true, exitCode: 0, version: '1.2.3' })).toEqual({ status: 'available', version: '1.2.3' });
  });
});
