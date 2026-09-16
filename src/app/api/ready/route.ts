import { pool, transaction } from '../../../lib/db';
import { validateOwnerAuthConfig } from '../../../lib/owner-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    validateOwnerAuthConfig({secret:process.env.BETTER_AUTH_SECRET??'',baseURL:process.env.BETTER_AUTH_URL??'',production:process.env.NODE_ENV==='production'});
    const envelope=process.env.BRIDGE_ENVELOPE_KEY??'';
    if(!/^[A-Za-z0-9+/]{43}=$/.test(envelope)||Buffer.from(envelope,'base64').length!==32)throw Error('Configuration unavailable');
    const ready=await transaction(pool,async client=> {
      const result=await client.query('SELECT 1 FROM bridge_migrations WHERE name=$1',['005-transfer-attempts.sql']);
      return result.rowCount===1;
    });
    return Response.json({ready},{status:ready?200:503,headers:{'Cache-Control':'no-store'}});
  }catch {
    return Response.json({ready:false},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
