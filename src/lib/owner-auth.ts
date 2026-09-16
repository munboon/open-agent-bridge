import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import type { Pool } from 'pg';

export interface OwnerAuthConfig {
  secret: string;
  baseURL: string;
  production?: boolean;
}

const authPaths = new Set([
  '/sign-in/email', '/sign-out', '/get-session', '/change-password',
  '/list-sessions', '/revoke-session', '/revoke-sessions', '/revoke-other-sessions',
]);
const sessionRequiredPaths = new Set([
  '/change-password',
  '/list-sessions', '/revoke-session', '/revoke-sessions', '/revoke-other-sessions',
]);

export function validateOwnerAuthConfig(config: OwnerAuthConfig): OwnerAuthConfig {
  if (config.secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  const url = new URL(config.baseURL);
  const octets = url.hostname.split('.').map(Number);
  const privateIPv4 = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168));
  const localHTTP = url.protocol === 'http:' && (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || privateIPv4);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && (!localHTTP || config.production))) {
    throw new Error('BETTER_AUTH_URL must be an HTTPS origin, or a development loopback or private LAN HTTP origin.');
  }
  return { ...config, baseURL: url.origin };
}

export function createOwnerAuth(database: Pool, input: OwnerAuthConfig) {
  const config = validateOwnerAuthConfig(input);
  const activeOwner = async (ownerId: string): Promise<boolean> => {
    const result = await database.query<{ active: boolean }>(
      'SELECT active FROM bridge_owner_state WHERE owner_id = $1', [ownerId],
    );
    return result.rows[0]?.active === true;
  };
  return betterAuth({
    appName: 'Open Agent Bridge',
    baseURL: config.baseURL,
    basePath: '/api/auth',
    secret: config.secret,
    database,
    trustedOrigins: [config.baseURL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: 16,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      freshAge: 60 * 10,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: 'oab',
      useSecureCookies: config.baseURL.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    databaseHooks: {
      session: { create: { before: async (session) => {
        if (!await activeOwner(session.userId)) {
          throw new APIError('FORBIDDEN', { code: 'OWNER_DISABLED', message: 'Owner access is unavailable.' });
        }
        return { data: session };
      } } },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Check login mutations even before a session cookie exists.
        if (ctx.request && !['GET', 'HEAD', 'OPTIONS'].includes(ctx.request.method)) {
          if (ctx.request.headers.get('origin') !== config.baseURL || ctx.request.headers.get('sec-fetch-site') === 'cross-site') {
            throw new APIError('FORBIDDEN', { code: 'INVALID_ORIGIN', message: 'Open the configured bridge address to sign in.' });
          }
        }
        if (!authPaths.has(ctx.path)) {
          throw new APIError('FORBIDDEN', { code: 'AUTH_OPERATION_DISABLED', message: 'This authentication operation is disabled.' });
        }
        if (ctx.body?.disableSession) {
          throw new APIError('FORBIDDEN', { code: 'AUTH_OPTION_DISABLED', message: 'A browser session is required for sign-in.' });
        }
        if(ctx.path==='/sign-in/email'&&typeof ctx.body?.email==='string'&&!ctx.body.email.includes('@')){
          const username=ctx.body.email.trim().toLowerCase();
          const matched=await database.query('SELECT u.email FROM bridge_administrators m JOIN "user" u ON u.id=m.user_id WHERE m.username=$1',[username]);
          if(matched.rowCount===1)ctx.body.email=matched.rows[0].email;
          else if(username==='admin'){
            const legacy=await database.query(`SELECT u.email FROM "user" u JOIN bridge_owner_state o ON o.owner_id=u.id WHERE NOT EXISTS(SELECT 1 FROM bridge_administrators m WHERE m.user_id=u.id) AND EXISTS(SELECT 1 FROM account a WHERE a."userId"=u.id AND a."providerId"='credential') LIMIT 2`);
            if(legacy.rowCount!==1)throw new APIError('UNAUTHORIZED',{code:'INVALID_EMAIL_OR_PASSWORD',message:'Invalid username or password.'});
            ctx.body.email=legacy.rows[0].email;
          }else throw new APIError('UNAUTHORIZED',{code:'INVALID_EMAIL_OR_PASSWORD',message:'Invalid username or password.'});
        }
        // Sign-out always remains available to clear a disabled user's cookie.
        if (ctx.path === '/sign-out') return;
        const session = await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true });
        if (session && !await activeOwner(session.user.id)) {
          throw new APIError('FORBIDDEN', { code: 'OWNER_DISABLED', message: 'Owner access is unavailable.' });
        }
        if (sessionRequiredPaths.has(ctx.path)) {
          if (!session) throw new APIError('UNAUTHORIZED', { message: 'Sign in first.' });
        }
      }),
    },
    logger: { level: 'error', log: () => { /* Do not emit auth payloads or secrets. */ } },
  });
}

export type OwnerAuth = ReturnType<typeof createOwnerAuth>;
let singleton: Promise<OwnerAuth> | undefined;

export function getOwnerAuth(): Promise<OwnerAuth> {
  singleton ??= (async () => {
    const { pool } = await import('./db');
    if (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL) {
      throw new Error('BETTER_AUTH_SECRET and BETTER_AUTH_URL are required.');
    }
    return createOwnerAuth(pool, {
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL,
      production: process.env.NODE_ENV === 'production',
    });
  })();
  return singleton;
}
