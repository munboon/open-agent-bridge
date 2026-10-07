import { z } from 'zod';

// null is an explicit unlimited choice; omitted input keeps each caller's default.
export const accessDays = z.number().int().min(1).max(90).nullable()
  .describe('1–90 days, or null for unlimited access until revoked.');
export function accessExpiry(days: number | null): Date | null {
  return days === null ? null : new Date(Date.now() + days * 86400000);
}
