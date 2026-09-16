// getRandomValues remains available on HTTP LAN origins where randomUUID does not.
export function browserRequestKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
