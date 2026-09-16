import { pool } from '@/lib/db';
import { handleAgentRequest } from '@/lib/agent-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleAgentRequest(request,pool);
export const POST = (request: Request) => handleAgentRequest(request,pool);
