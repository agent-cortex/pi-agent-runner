import { z } from 'zod';

export const createJobSchema = z.object({
  jobType: z.enum(['daily-crypto-brief', 'ping']),
  input: z.record(z.string(), z.any()).default({}),
  priority: z.number().int().min(1).max(10).optional(),
  callbackUrl: z.url().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
