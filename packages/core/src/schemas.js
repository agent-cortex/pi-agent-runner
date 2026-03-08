import { z } from 'zod';

const scheduleSchema = z
  .object({
    // Run once at a specific date/time (ISO string)
    runAt: z.iso.datetime().optional(),
    // Repeat every N seconds
    everySeconds: z.number().int().min(1).optional(),
    // Or repeat by cron expression
    cron: z.string().min(1).optional(),
    tz: z.string().min(1).optional(),
  })
  .optional();

export const createJobSchema = z.object({
  jobType: z.enum(['daily-crypto-brief', 'ping', 'reminder']),
  input: z.record(z.string(), z.any()).default({}),
  priority: z.number().int().min(1).max(10).optional(),
  callbackUrl: z.url().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  schedule: scheduleSchema,
  scheduleBackend: z.enum(['bullmq', 'systemd']).default('bullmq').optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
