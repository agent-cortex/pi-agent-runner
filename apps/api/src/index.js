import 'dotenv/config';
import Fastify from 'fastify';
import { Queue } from 'bullmq';
import { createRedisConnection, QUEUE_NAME } from '../../../packages/core/src/queue.js';
import { createJobSchema } from '../../../packages/core/src/schemas.js';

const app = Fastify({ logger: true });
const connection = createRedisConnection();
const queue = new Queue(QUEUE_NAME, { connection });

function checkAuth(req, reply) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.RUNNER_API_TOKEN || token !== process.env.RUNNER_API_TOKEN) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

app.get('/health', async () => ({ ok: true, service: 'api' }));

app.post('/jobs', async (req, reply) => {
  if (!checkAuth(req, reply)) return;

  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.issues });
  }

  const { jobType, input, priority = 5, callbackUrl, metadata, schedule } = parsed.data;

  if (jobType === 'reminder' && !String(input?.message || '').trim()) {
    return reply.code(400).send({ error: 'invalid_payload', details: 'reminder.input.message is required' });
  }

  if (schedule?.everySeconds && schedule?.cron) {
    return reply.code(400).send({
      error: 'invalid_payload',
      details: 'schedule.everySeconds and schedule.cron are mutually exclusive',
    });
  }

  const options = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 500,
    priority,
  };

  if (schedule?.runAt) {
    const runAt = new Date(schedule.runAt).getTime();
    const delay = runAt - Date.now();
    if (!Number.isFinite(runAt) || delay <= 0) {
      return reply.code(400).send({ error: 'invalid_payload', details: 'schedule.runAt must be in the future' });
    }
    options.delay = delay;
  }

  if (schedule?.everySeconds) {
    options.repeat = { every: schedule.everySeconds * 1000 };
  } else if (schedule?.cron) {
    options.repeat = { pattern: schedule.cron, tz: schedule.tz || process.env.TZ || 'Asia/Kolkata' };
  }

  const job = await queue.add(jobType, { jobType, input, callbackUrl, metadata, schedule }, options);

  return reply.code(202).send({
    jobId: job.id,
    status: 'queued',
    scheduled: Boolean(schedule?.runAt || schedule?.everySeconds || schedule?.cron),
  });
});

app.get('/jobs/:id', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const { id } = req.params;
  const job = await queue.getJob(id);
  if (!job) return reply.code(404).send({ error: 'not_found' });

  const state = await job.getState();
  return {
    id: job.id,
    name: job.name,
    state,
    attemptsMade: job.attemptsMade,
    progress: job.progress,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    data: job.data,
  };
});

app.get('/jobs', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const states = ['active', 'waiting', 'delayed', 'completed', 'failed'];
  const jobs = await queue.getJobs(states, 0, 50, true);
  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    timestamp: job.timestamp,
    attemptsMade: job.attemptsMade,
    finishedOn: job.finishedOn,
  }));
});

app.get('/queues/stats', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
});

const port = Number(process.env.PORT || 8787);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
