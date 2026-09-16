import { getOwnerAuth } from '../../../../lib/owner-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return (await getOwnerAuth()).handler(request);
}

export async function POST(request: Request) {
  return (await getOwnerAuth()).handler(request);
}
