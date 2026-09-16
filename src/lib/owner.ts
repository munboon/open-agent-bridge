import type { Pool } from 'pg';
import { isAPIError } from 'better-auth/api';
import { getOwnerAuth, type OwnerAuth } from './owner-auth';

export class OwnerAuthError extends Error {
  constructor(public readonly status: 401 | 403, public readonly code: string) {
    super(code);
    this.name = 'OwnerAuthError';
  }
}

export function ownerAuthErrorResponse(error: unknown): Response {
  if (!(error instanceof OwnerAuthError)) throw error;
  return Response.json({ error: { code: error.code, message: 'Owner authorization required.' } }, {
    status: error.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function createOwnerGuard(auth: OwnerAuth, database: Pool) {
  return async (request: Request): Promise<{ id: string; email: string }> => {
    // This boundary serves browser administration. Machine keys are separate.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const expected = new URL(auth.options.baseURL as string).origin;
      if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') {
        throw new OwnerAuthError(403, 'INVALID_ORIGIN');
      }
    }
    let session;
    try {
      session = await auth.api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
    } catch (error) {
      if (isAPIError(error) && error.body?.code === 'OWNER_DISABLED') {
        throw new OwnerAuthError(403, 'OWNER_DISABLED');
      }
      throw error;
    }
    if (!session) throw new OwnerAuthError(401, 'OWNER_UNAUTHENTICATED');
    const result = await database.query<{
      id: string; email: string; active: boolean;
    }>(
      'SELECT u.id, u.email, o.active ' +
      'FROM "session" s JOIN "user" u ON u.id = s."userId" ' +
      'JOIN bridge_owner_state o ON o.owner_id = u.id ' +
      'WHERE s.id = $1 AND s."userId" = $2 AND s."expiresAt" > now()',
      [session.session.id, session.user.id],
    );
    const owner = result.rows[0];
    if (!owner) throw new OwnerAuthError(401, 'OWNER_UNAUTHENTICATED');
    if (!owner.active) throw new OwnerAuthError(403, 'OWNER_DISABLED');
    return { id: owner.id, email: owner.email };
  };
}

export async function requireOwner(request: Request): Promise<{ id: string; email: string }> {
  const [{ pool }, auth] = await Promise.all([import('./db'), getOwnerAuth()]);
  return createOwnerGuard(auth, pool)(request);
}
