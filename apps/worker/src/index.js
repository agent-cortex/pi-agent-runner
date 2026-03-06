import 'dotenv/config';
import { Worker, QueueEvents } from 'bullmq';
import { createRedisConnection, QUEUE_NAME } from '../../../packages/core/src/queue.js';
import { runJob } from '../../../packages/jobs/src/registry.js';
import { sendCallbackSafe } from '../../../packages/notifier/src/webhook.js';

const connection = createRedisConnection();

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const startedAt = new Date().toISOString();
    const result = await runJob(job.name, job.data?.input ?? {}, { jobId: String(job.id) });
    const finishedAt = new Date().toISOString();

    await sendCallbackSafe({
      callbackUrl: job.data?.callbackUrl || process.env.CALLBACK_URL,
      secret: process.env.WEBHOOK_SECRET || '',
      event: 'job.completed',
      payload: {
        jobId: String(job.id),
        jobType: job.name,
        status: 'completed',
        startedAt,
        finishedAt,
        summary: result?.summary || `${job.name} completed`,
        artifactPath: result?.artifactPath || null,
        data: result || {},
      },
    });

    return result;
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY || 2),
  }
);

worker.on('failed', async (job, err) => {
  await sendCallbackSafe({
    callbackUrl: job?.data?.callbackUrl || process.env.CALLBACK_URL,
    secret: process.env.WEBHOOK_SECRET || '',
    event: 'job.failed',
    payload: {
      jobId: String(job?.id ?? ''),
      jobType: job?.name ?? 'unknown',
      status: 'failed',
      error: err?.message || 'unknown error',
      attemptsMade: job?.attemptsMade ?? 0,
    },
  });
});

const events = new QueueEvents(QUEUE_NAME, { connection });
events.on('completed', ({ jobId }) => console.log(`[queue] completed ${jobId}`));
events.on('failed', ({ jobId, failedReason }) => console.log(`[queue] failed ${jobId}: ${failedReason}`));

console.log('worker started');
