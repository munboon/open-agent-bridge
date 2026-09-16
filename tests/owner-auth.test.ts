import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { bootstrapOwner } from '../scripts/bootstrap-owner';
import { createOwnerAuth, validateOwnerAuthConfig, type OwnerAuth } from '../src/lib/owner-auth';
import { createOwnerGuard, OwnerAuthError, ownerAuthErrorResponse } from '../src/lib/owner';

describe('owner auth configuration', () => {
  const secret = randomBytes(32).toString('hex');
  it('requires a secret and rejects unsafe production origins', () => {
    expect(() => validateOwnerAuthConfig({ secret: '', baseURL: 'https://bridge.example' })).toThrow();
    for (const baseURL of ['http://bridge.example', 'https://user:pass@bridge.example', 'https://bridge.example/path']) {
      expect(() => validateOwnerAuthConfig({ secret, baseURL })).toThrow();
    }
    expect(() => validateOwnerAuthConfig({ secret, baseURL: 'http://127.0.0.1:3220', production: true })).toThrow();
    expect(validateOwnerAuthConfig({ secret, baseURL: 'http://127.0.0.1:3220' }).baseURL).toBe('http://127.0.0.1:3220');
  });
  it('allows private LAN HTTP only in development', () => {
    for (const host of ['10.0.0.2', '172.16.0.2', '172.31.255.254', '192.168.50.10']) {
      const baseURL = `http://${host}:3220`;
      expect(validateOwnerAuthConfig({ secret, baseURL }).baseURL).toBe(baseURL);
      expect(() => validateOwnerAuthConfig({ secret, baseURL, production: true })).toThrow();
    }
    for (const host of ['172.15.0.1', '172.32.0.1', '192.169.0.1', '8.8.8.8', '0.0.0.0', '192.168.1.1.example']) {
      expect(() => validateOwnerAuthConfig({ secret, baseURL: `http://${host}:3220` })).toThrow();
    }
  });
  it('returns structured auth failures and never converts unexpected errors to success', () => {
    expect(ownerAuthErrorResponse(new OwnerAuthError(403, 'INVALID_ORIGIN')).status).toBe(403);
    expect(() => ownerAuthErrorResponse(new Error('unexpected'))).toThrow('unexpected');
  });
});

const testURL = process.env.TEST_DATABASE_URL;
describe.skipIf(!testURL)('owner authentication against isolated PostgreSQL', () => {
  let database: Pool;
  let auth: OwnerAuth;
  let guard: ReturnType<typeof createOwnerGuard>;
  let ownerId: string;
  let passwordCookie = '';
  let legacyCookie = '';
  const password = randomBytes(24).toString('base64url');
  const email = `owner-${randomUUID()}@example.invalid`;
  const baseURL = 'http://127.0.0.1:3220';
  const ipNamespace = randomBytes(2).toString('hex');
  let requestIndex = 1;

  async function call(path: string, body?: Record<string, unknown>, cookie = '', ip?: string, origin = baseURL) {
    const headers = new Headers({ origin, 'x-forwarded-for': ip ?? `2001:db8:${ipNamespace}:${(requestIndex++ * 256).toString(16)}::1` });
    if (body) headers.set('content-type', 'application/json');
    if (cookie) headers.set('cookie', cookie);
    return auth.handler(new Request(`${baseURL}/api/auth${path}`, {
      method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined,
    }));
  }
  function cookieFrom(response: Response, previous = '') {
    const jar = new Map(previous.split('; ').filter(Boolean).map((value) => {
      const separator = value.indexOf('=');
      return [value.slice(0, separator), value.slice(separator + 1)];
    }));
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const separator = pair.indexOf('=');
      if (pair.slice(separator + 1)) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
      else jar.delete(pair.slice(0, separator));
    }
    return [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
  }
  function adminRequest(cookie: string, method = 'GET', origin = baseURL) {
    return new Request(`${baseURL}/api/admin/projects`, { method, headers: { cookie, origin } });
  }

  beforeAll(async () => {
    const url = new URL(testURL!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55442' || url.pathname !== '/oab_test' || url.username !== 'oab_test') {
      throw new Error('Owner integration tests require the isolated loopback oab_test database and login.');
    }
    database = new Pool({ connectionString: testURL, max: 3 });
    const migration = await database.connect();
    try {
      await migration.query('BEGIN');
      await migration.query(await readFile(new URL('../db/owner-auth.sql', import.meta.url), 'utf8'));
      await migration.query('COMMIT');
    } catch (error) {
      await migration.query('ROLLBACK');
      throw error;
    } finally { migration.release(); }
    const existing = await database.query('SELECT 1 FROM "user" LIMIT 1');
    if (existing.rowCount) throw new Error('Owner tests require an empty auth fixture; existing users are preserved.');
    auth = createOwnerAuth(database, { secret: randomBytes(32).toString('hex'), baseURL });
    guard = createOwnerGuard(auth, database);
    ownerId = (await bootstrapOwner(database, { email, password, name: 'Synthetic owner' })).id;
  }, 30000);

  afterAll(async () => {
    if (!database) return;
    // Only delete this suite's own synthetic owner; never truncate shared tables.
    if (ownerId) await database.query('DELETE FROM "user" WHERE id = $1 AND email = $2', [ownerId, email]);
    await database.end();
  });

  it('rejects public signup and repeated local bootstrap', async () => {
    const response = await call('/sign-up/email', { email: 'uninvited@example.invalid', name: 'Uninvited', password });
    expect(response.status).toBe(403);
    await expect(bootstrapOwner(database, { email: 'second@example.invalid', name: 'Second', password })).rejects.toThrow('already complete');
    expect((await database.query('SELECT count(*)::int AS count FROM "user"')).rows[0].count).toBe(1);
  });

  it('rejects missing/forged sessions and wrong passwords, then admits a new owner directly after password login', async () => {
    await expect(guard(adminRequest(''))).rejects.toMatchObject({ status: 401 });
    await expect(guard(adminRequest('oab.session_token=forged'))).rejects.toMatchObject({ status: 401 });
    const wrong = await call('/sign-in/email', { email, password: 'incorrect-long-password' });
    expect(wrong.status).toBe(401);
    await expect(guard(adminRequest(cookieFrom(wrong)))).rejects.toMatchObject({ status: 401 });
    const login = await call('/sign-in/email', { email, password });
    expect(login.status).toBe(200);
    const payload = await login.json();
    expect(payload.twoFactorRedirect).not.toBe(true);
    expect(payload.user.id).toBe(ownerId);
    passwordCookie = cookieFrom(login);
    expect(passwordCookie).toContain('oab.session_token=');
    await expect(guard(adminRequest(passwordCookie))).resolves.toEqual({ id: ownerId, email });
    expect((await database.query('SELECT "twoFactorEnabled" FROM "user" WHERE id=$1', [ownerId])).rows[0].twoFactorEnabled).toBe(false);
  });

  it('ignores historical enrollment flags and authenticator records without rewriting them or challenging the owner', async () => {
    await database.query('UPDATE "user" SET "twoFactorEnabled"=true WHERE id=$1', [ownerId]);
    await database.query('INSERT INTO "twoFactor"(id,secret,"backupCodes","userId",verified) VALUES($1,$2,$3,$4,true)',
      [randomUUID(), 'synthetic-historical-secret-not-used', 'synthetic-historical-codes-not-used', ownerId]);
    const login = await call('/sign-in/email', { email, password });
    expect(login.status).toBe(200);
    const payload = await login.json();
    expect(payload.twoFactorRedirect).not.toBe(true);
    expect(payload.user.id).toBe(ownerId);
    legacyCookie = cookieFrom(login);
    await expect(guard(adminRequest(legacyCookie))).resolves.toEqual({ id: ownerId, email });
    await expect(guard(adminRequest(passwordCookie))).resolves.toEqual({ id: ownerId, email });
    expect((await database.query('SELECT "twoFactorEnabled" FROM "user" WHERE id=$1', [ownerId])).rows[0].twoFactorEnabled).toBe(true);
    expect((await database.query('SELECT count(*)::int AS count FROM "twoFactor" WHERE "userId"=$1', [ownerId])).rows[0].count).toBe(1);
    expect((await database.query('SELECT "bridgeMfaVerified" FROM "session" WHERE token=$1', [payload.token])).rows[0].bridgeMfaVerified).toBe(false);
  });

  it('resolves admin to the provisioned owner and still requires its password', async () => {
    const fixtureId = randomUUID();
    await database.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,now(),now())', [fixtureId, 'Non-login fixture', `${fixtureId}@example.invalid`]);
    await database.query('INSERT INTO bridge_owner_state(owner_id,active) VALUES($1,true)', [fixtureId]);
    try {
    expect((await call('/sign-in/email', { email: 'admin', password: 'incorrect-long-password' })).status).toBe(401);
    const login = await call('/sign-in/email', { email: 'admin', password });
    expect(login.status).toBe(200);
    await expect(guard(adminRequest(cookieFrom(login)))).resolves.toEqual({ id: ownerId, email });
    expect((await call('/sign-in/email', { email: 'admin', password }, '', undefined, 'https://evil.example')).status).toBe(403);
    await database.query('UPDATE bridge_owner_state SET active=false WHERE owner_id=$1', [ownerId]);
    try { expect((await call('/sign-in/email', { email: 'admin', password })).status).toBe(403); }
    finally { await database.query('UPDATE bridge_owner_state SET active=true WHERE owner_id=$1', [ownerId]); }
    } finally { await database.query('DELETE FROM "user" WHERE id=$1', [fixtureId]); }
  });

  it('makes authenticator endpoints unavailable and rejects arbitrary session-field updates', async () => {
    for (const path of ['/two-factor/enable', '/two-factor/disable', '/two-factor/verify-totp', '/two-factor/verify-backup-code', '/two-factor/generate-backup-codes']) {
      expect([403, 404]).toContain((await call(path, { password, code: '000000' }, legacyCookie)).status);
    }
    expect((await call('/update-session', { bridgeMfaVerified: true }, passwordCookie)).status).toBe(403);
  });

  it('retains exact-origin and cross-site protections for password-authenticated administration', async () => {
    await expect(guard(adminRequest(passwordCookie, 'POST', 'https://evil.example'))).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    const missing = adminRequest(passwordCookie, 'POST'); missing.headers.delete('origin');
    await expect(guard(missing)).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    const crossSite = adminRequest(passwordCookie, 'POST'); crossSite.headers.set('sec-fetch-site', 'cross-site');
    await expect(guard(crossSite)).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    await expect(guard(adminRequest(passwordCookie, 'POST'))).resolves.toEqual({ id: ownerId, email });
    expect((await call('/sign-in/email', { email, password }, '', undefined, 'https://evil.example')).status).toBe(403);
    for (const mode of ['missing-origin', 'cross-site']) {
      const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': `2001:db8:${ipNamespace}:ee00::1` });
      if (mode === 'cross-site') { headers.set('origin', baseURL); headers.set('sec-fetch-site', 'cross-site'); }
      const response = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: 'POST', headers, body: JSON.stringify({ email, password }),
      }));
      expect(response.status).toBe(403);
    }
  });

  it('requires an authenticated session for sensitive operations and allows password sessions to revoke another session', async () => {
    expect((await call('/list-sessions')).status).toBe(401);
    expect((await call('/revoke-session', { token: 'synthetic-invalid-token' })).status).toBe(401);
    expect((await call('/list-sessions', undefined, passwordCookie)).status).toBe(200);
    const otherLogin = await call('/sign-in/email', { email, password });
    expect(otherLogin.status).toBe(200);
    const otherPayload = await otherLogin.json(), otherCookie = cookieFrom(otherLogin);
    const revoke = await call('/revoke-session', { token: otherPayload.token }, passwordCookie);
    expect(revoke.status).toBe(200);
    await expect(guard(adminRequest(otherCookie))).rejects.toMatchObject({ status: 401 });
    await expect(guard(adminRequest(passwordCookie))).resolves.toEqual({ id: ownerId, email });
    expect((await call('/change-password', { currentPassword: 'incorrect-long-password', newPassword: randomBytes(24).toString('base64url') }, passwordCookie)).status).toBe(400);
  });

  it('rejects an expired session without invalidating another live password session', async () => {
    const login = await call('/sign-in/email', { email, password });
    expect(login.status).toBe(200);
    const payload = await login.json(), expiredCookie = cookieFrom(login);
    await database.query('UPDATE "session" SET "expiresAt"=now()-interval \'1 second\' WHERE token=$1', [payload.token]);
    await expect(guard(adminRequest(expiredCookie))).rejects.toMatchObject({ status: 401 });
    await expect(guard(adminRequest(passwordCookie))).resolves.toEqual({ id: ownerId, email });
  });

  it('blocks disabled owners with existing sessions and new sign-ins', async () => {
    await database.query('UPDATE bridge_owner_state SET active = false WHERE owner_id = $1', [ownerId]);
    try {
      await expect(guard(adminRequest(passwordCookie))).rejects.toMatchObject({ code: 'OWNER_DISABLED', status: 403 });
      expect((await call('/list-sessions', undefined, legacyCookie)).status).toBe(403);
      expect((await call('/sign-in/email', { email, password })).status).toBe(403);
    } finally {
      await database.query('UPDATE bridge_owner_state SET active = true WHERE owner_id = $1', [ownerId]);
    }
  });

  it('enforces login throttling and immediately rejects revoked sessions', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      statuses.push((await call('/sign-in/email', { email, password: 'incorrect-long-password' }, '', `2001:db8:${ipNamespace}:ff00::1`)).status);
    }
    expect(statuses).toContain(429);
    await database.query('DELETE FROM "session" WHERE "userId" = $1', [ownerId]);
    await expect(guard(adminRequest(passwordCookie))).rejects.toMatchObject({ status: 401 });
    await expect(guard(adminRequest(legacyCookie))).rejects.toMatchObject({ status: 401 });
  });
});
