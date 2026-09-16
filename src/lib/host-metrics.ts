import { z } from 'zod';
export const hostMetricsSchema = z.strictObject({
  cpu_percent:z.number().min(0).max(100).nullable(),
  cpu_count:z.number().int().min(0).max(65536),
  memory_total_bytes:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  memory_available_bytes:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  platform:z.string().regex(/^[a-z0-9_-]{1,24}$/),
});
export type HostMetrics = z.infer<typeof hostMetricsSchema>;
