import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { api } from '../src/components/ui';
import { browserRequestKey } from '../src/lib/browser-request-key';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP LAN browser requests', () => {
  function useLANBrowserCrypto() {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  }
  it('sends login when randomUUID is unavailable', async () => {
    useLANBrowserCrypto();
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/api/auth/sign-in/email', { email: 'test@example.invalid', password: 'synthetic' })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/auth/sign-in/email', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^[a-f0-9]{32}$/) }),
    }));
  });
  it('generates distinct keys and preserves the supplied key for message retries', async () => {
    useLANBrowserCrypto();
    const key = browserRequestKey();
    expect(browserRequestKey()).not.toBe(key);
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await api('/api/admin/projects/example/messages', { body: 'synthetic' }, key);
    await api('/api/admin/projects/example/messages', { body: 'synthetic' }, key);
    for (const [, options] of fetch.mock.calls) expect(options.headers['Idempotency-Key']).toBe(key);
  });
});
