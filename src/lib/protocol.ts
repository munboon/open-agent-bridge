import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export class BridgeError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fail(status: number, code: string, message: string): never { throw new BridgeError(status, code, message); }
export const inaccessible = () => fail(404, 'NOT_FOUND', 'Resource not found.');
export const uuid = z.uuid();
export const label = z.string().trim().min(1).max(120);
export const messageBody = z.string().min(1).refine(value => Buffer.byteLength(value) <= 65536, 'Text exceeds 64 KiB.');
export const plainMessage = z.strictObject({ conversation_id: uuid, recipient_agent_id: uuid,
  task_id: uuid.optional(), type: z.enum(['note','progress','question','result']), body: messageBody });
export const taskCreate = z.strictObject({ conversation_id: uuid, recipient_agent_id: uuid, title: label, instructions: messageBody });
export const taskAction = z.strictObject({ claim_generation: z.number().int().nonnegative().optional(),
  type: z.enum(['progress','question','completed','failed','cancelled']).optional(),
  evidence: messageBody.optional(), outcome: z.enum(['completed','cancelled','continue','uncertain']).optional(),
  local_operation_stopped: z.boolean().optional(), duration_seconds: z.number().int().min(1).max(3600).optional(), stage: label.optional() });
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function errorResponse(error: unknown): Response {
  const request_id = randomUUID();
  if (error instanceof z.ZodError) return json({ code: 'INVALID_REQUEST', message: 'Request does not match the API schema.', request_id }, 422);
  if (error instanceof BridgeError) {
    const response = json({ code: error.code, message: error.message, request_id }, error.status);
    if (error.status === 429 || error.status === 503) response.headers.set('Retry-After', '5');
    return response;
  }
  // Never serialize database diagnostics, credentials, or request bodies.
  const response=json({ code: 'SERVICE_UNAVAILABLE', message: 'The bridge could not complete this request.', request_id }, 503);
  response.headers.set('Retry-After','5');
  return response;
}
export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415,'CONTENT_TYPE','Use application/json.');
  const reader = request.body?.getReader();
  if (!reader) fail(422,'INVALID_REQUEST','A JSON body is required.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 524288) { await reader.cancel(); fail(413,'BODY_TOO_LARGE','Request exceeds 512 KiB.'); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    fail(422,'INVALID_JSON','A valid JSON body is required.');
  }
}
