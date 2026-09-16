import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Transaction } from './db';
import { audit, newCredential } from './agent-auth';
import { fail } from './protocol';

type Envelope = { version: number; iv: string; ciphertext: string; tag: string };
function key() {
  const value = process.env.BRIDGE_ENVELOPE_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) fail(503, 'ENVELOPE_UNCONFIGURED', 'Config encryption is not configured.');
  return Buffer.from(value, 'base64');
}
export function pendingAccess(envelope: Envelope, agentId: string, credentialId: string): string {
  if (envelope.version !== 1) fail(503, 'ENVELOPE_VERSION', 'Config encryption version is unsupported.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`agent-kit:${agentId}:${credentialId}`));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
export async function prepareAgentAccess(client: Transaction, ownerId: string, projectId: string, agentId: string) {
  const credential = newCredential(), expires = new Date(Date.now() + 60 * 86400000);
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`agent-kit:${agentId}:${credential.id}`));
  const ciphertext = Buffer.concat([cipher.update(credential.token, 'utf8'), cipher.final()]);
  const envelope: Envelope = { version: 1, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  await client.query('INSERT INTO bridge_credentials(id,agent_id,digest,expires_at,kit_envelope) VALUES($1,$2,$3,$4,$5)', [credential.id,agentId,credential.digest,expires,envelope]);
  await audit(client,{id:ownerId,owner_id:ownerId,project_id:projectId},'credential.prepare',credential.id);
  return { id: credential.id, expires_at: expires };
}
