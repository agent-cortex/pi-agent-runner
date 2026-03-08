import 'dotenv/config';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Queue } from 'bullmq';
import { createRedisConnection, QUEUE_NAME } from '../../../packages/core/src/queue.js';
import { createJobSchema } from '../../../packages/core/src/schemas.js';
import { getSchedule, listSchedules, putSchedule, removeSchedule, updateSchedule } from './schedule-store.js';

const app = Fastify({ logger: true });
const connection = createRedisConnection();
const queue = new Queue(QUEUE_NAME, { connection });

const DATA_DIR = process.env.RUNNER_DATA_DIR || '/app/data';
const SYSTEMD_MANIFEST_DIR = path.join(DATA_DIR, 'systemd-manifests');
const SYSTEMD_JOB_ALLOWLIST = new Set(['reminder', 'ping', 'daily-crypto-brief']);

function checkAuth(req, reply) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.RUNNER_API_TOKEN || token !== process.env.RUNNER_API_TOKEN) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

async function readIdempotency(key) {
  const redisKey = `runner:idempotency:${key}`;
  const value = await connection.get(redisKey);
  if (!value) return null;
  return JSON.parse(value);
}

async function writeIdempotency(key, payload) {
  const redisKey = `runner:idempotency:${key}`;
  const ttl = Number(process.env.IDEMPOTENCY_TTL_SECONDS || 86400);
  await connection.set(redisKey, JSON.stringify(payload), 'EX', ttl);
}

function buildRepeat(schedule, repeatKey) {
  if (!schedule) return null;
  if (schedule.everySeconds) return { every: schedule.everySeconds * 1000, key: repeatKey };
  if (schedule.cron) return { pattern: schedule.cron, tz: schedule.tz || process.env.TZ || 'Asia/Kolkata', key: repeatKey };
  return null;
}

async function ensureManifestDir() {
  await fs.mkdir(SYSTEMD_MANIFEST_DIR, { recursive: true });
}

function systemdManifestPath(jobId) {
  return path.join(SYSTEMD_MANIFEST_DIR, `${jobId}.json`);
}

async function createSystemdManifest({ jobId, jobType, input, callbackUrl, metadata, schedule }) {
  await ensureManifestDir();
  const manifest = {
    schema: 'pi-agent-runner.systemd-manifest.v1',
    id: jobId,
    enabled: true,
    createdAt: new Date().toISOString(),
    unitName: `piar-${jobId}`,
    template: `job-${jobType}`,
    payload: { jobType, input, callbackUrl: callbackUrl || null, metadata: metadata || {}, schedule },
  };
  const filePath = systemdManifestPath(jobId);
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2));
  return { manifest, filePath };
}

async function updateSystemdManifest(jobId, patch = {}) {
  const filePath = systemdManifestPath(jobId);
  const raw = await fs.readFile(filePath, 'utf8');
  const current = JSON.parse(raw);
  const next = {
    ...current,
    ...patch,
    payload: {
      ...(current.payload || {}),
      ...(patch.payload || {}),
    },
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(next, null, 2));
  return { manifest: next, filePath };
}

async function deleteSystemdManifest(jobId) {
  const filePath = systemdManifestPath(jobId);
  await fs.rm(filePath, { force: true });
}

app.get('/health', async () => ({ ok: true, service: 'api' }));

app.post('/jobs', async (req, reply) => {
  if (!checkAuth(req, reply)) return;

  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.issues });
  }

  const {
    jobType,
    input,
    priority = 5,
    callbackUrl,
    metadata,
    schedule,
    scheduleBackend = 'bullmq',
    idempotencyKey,
  } = parsed.data;

  const requestIdempotencyKey = String(req.headers['idempotency-key'] || idempotencyKey || '').trim();
  if (requestIdempotencyKey) {
    const existing = await readIdempotency(requestIdempotencyKey);
    if (existing) {
      return reply.code(200).send({ ...existing, deduplicated: true });
    }
  }

  if (jobType === 'reminder' && !String(input?.message || '').trim()) {
    return reply.code(400).send({ error: 'invalid_payload', details: 'reminder.input.message is required' });
  }

  if (schedule?.everySeconds && schedule?.cron) {
    return reply.code(400).send({
      error: 'invalid_payload',
      details: 'schedule.everySeconds and schedule.cron are mutually exclusive',
    });
  }

  if (scheduleBackend === 'systemd') {
    if (!schedule || (!schedule.runAt && !schedule.everySeconds && !schedule.cron)) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: 'systemd backend requires schedule.runAt or schedule.everySeconds or schedule.cron',
      });
    }

    if (!SYSTEMD_JOB_ALLOWLIST.has(jobType)) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: `jobType '${jobType}' is not allowlisted for systemd backend`,
      });
    }

    const scheduleId = `sysd-${crypto.randomUUID()}`;
    const { filePath } = await createSystemdManifest({ jobId: scheduleId, jobType, input, callbackUrl, metadata, schedule });

    await putSchedule(scheduleId, {
      id: scheduleId,
      backend: 'systemd',
      enabled: true,
      jobType,
      input,
      callbackUrl: callbackUrl || null,
      metadata: metadata || {},
      schedule,
      manifestPath: filePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const responsePayload = {
      jobId: scheduleId,
      status: 'scheduled',
      backend: 'systemd',
      scheduled: true,
      installState: 'manifest_written',
    };

    if (requestIdempotencyKey) await writeIdempotency(requestIdempotencyKey, responsePayload);
    return reply.code(202).send(responsePayload);
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

  const hasRecurringSchedule = Boolean(schedule?.everySeconds || schedule?.cron);
  const repeatKey = hasRecurringSchedule ? `repeat:${jobType}:${crypto.randomUUID()}` : null;
  const repeat = buildRepeat(schedule, repeatKey);
  if (repeat) options.repeat = repeat;

  const job = await queue.add(jobType, { jobType, input, callbackUrl, metadata, schedule }, options);

  if (hasRecurringSchedule) {
    await putSchedule(String(job.id), {
      id: String(job.id),
      backend: 'bullmq',
      enabled: true,
      jobType,
      input,
      callbackUrl: callbackUrl || null,
      metadata: metadata || {},
      schedule,
      repeatKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const responsePayload = {
    jobId: job.id,
    status: 'queued',
    backend: 'bullmq',
    scheduled: Boolean(schedule?.runAt || schedule?.everySeconds || schedule?.cron),
  };

  if (requestIdempotencyKey) await writeIdempotency(requestIdempotencyKey, responsePayload);

  return reply.code(202).send(responsePayload);
});

app.get('/jobs/:id', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const { id } = req.params;

  const scheduleInfo = await getSchedule(id);
  if (scheduleInfo?.backend === 'systemd') {
    return {
      id: scheduleInfo.id,
      name: scheduleInfo.jobType,
      state: scheduleInfo.enabled ? 'scheduled' : 'paused',
      data: {
        jobType: scheduleInfo.jobType,
        input: scheduleInfo.input,
        callbackUrl: scheduleInfo.callbackUrl,
        metadata: scheduleInfo.metadata,
        schedule: scheduleInfo.schedule,
        backend: scheduleInfo.backend,
      },
      schedule: scheduleInfo,
    };
  }

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

app.get('/schedules', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  return { schedules: await listSchedules() };
});

app.patch('/jobs/:id', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const { id } = req.params;
  const action = String(req.body?.action || '').trim();
  if (!['pause', 'resume'].includes(action)) {
    return reply.code(400).send({ error: 'invalid_payload', details: 'action must be pause|resume' });
  }

  const schedule = await getSchedule(id);
  if (!schedule) return reply.code(404).send({ error: 'not_found' });

  if (schedule.backend === 'systemd') {
    const enabled = action === 'resume';
    await updateSystemdManifest(id, { enabled });
    const updated = await updateSchedule(id, { enabled });
    return { ok: true, id, backend: 'systemd', enabled: updated.enabled, note: 'manifest + schedule updated; installer will sync timer state' };
  }

  if (schedule.backend === 'bullmq') {
    if (action === 'pause') {
      if (!schedule.repeatKey || !schedule.schedule) {
        return reply.code(400).send({ error: 'invalid_state', details: 'missing repeat metadata for pause' });
      }
      const repeat = buildRepeat(schedule.schedule, schedule.repeatKey);
      await queue.removeRepeatable(schedule.jobType, repeat);
      await updateSchedule(id, { enabled: false });
      return { ok: true, id, backend: 'bullmq', enabled: false };
    }

    // resume
    const repeat = buildRepeat(schedule.schedule, schedule.repeatKey || `repeat:${schedule.jobType}:${crypto.randomUUID()}`);
    await queue.add(
      schedule.jobType,
      {
        jobType: schedule.jobType,
        input: schedule.input,
        callbackUrl: schedule.callbackUrl,
        metadata: schedule.metadata,
        schedule: schedule.schedule,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 200,
        removeOnFail: 500,
        priority: 5,
        repeat,
      }
    );
    const updated = await updateSchedule(id, { enabled: true, repeatKey: repeat.key });
    return { ok: true, id, backend: 'bullmq', enabled: updated.enabled };
  }

  return reply.code(400).send({ error: 'unsupported_backend' });
});

app.delete('/jobs/:id', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const { id } = req.params;

  const schedule = await getSchedule(id);
  if (schedule) {
    if (schedule.backend === 'bullmq' && schedule.repeatKey && schedule.schedule) {
      const repeat = buildRepeat(schedule.schedule, schedule.repeatKey);
      await queue.removeRepeatable(schedule.jobType, repeat).catch(() => {});
    }
    if (schedule.backend === 'systemd') {
      await deleteSystemdManifest(id);
    }
    await removeSchedule(id);
    return { ok: true, id, removed: true, backend: schedule.backend };
  }

  const job = await queue.getJob(id);
  if (!job) return reply.code(404).send({ error: 'not_found' });
  await job.remove();
  return { ok: true, id, removed: true, backend: 'bullmq' };
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

app.post('/internal/systemd/trigger/:id', async (req, reply) => {
  const token = String(req.headers['x-installer-token'] || '');
  const expected = process.env.INSTALLER_TOKEN || '';
  if (expected && token !== expected) {
    return reply.code(401).send({ error: 'unauthorized_installer' });
  }

  const { id } = req.params;
  const schedule = await getSchedule(id);
  if (!schedule || schedule.backend !== 'systemd') {
    return reply.code(404).send({ error: 'not_found' });
  }
  if (schedule.enabled === false) {
    return reply.code(409).send({ error: 'schedule_paused' });
  }

  const job = await queue.add(
    schedule.jobType,
    {
      jobType: schedule.jobType,
      input: schedule.input,
      callbackUrl: schedule.callbackUrl,
      metadata: {
        ...(schedule.metadata || {}),
        scheduleBackend: 'systemd',
        scheduleId: id,
      },
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
      priority: 5,
    }
  );

  return { ok: true, scheduleId: id, queuedJobId: job.id };
});

const port = Number(process.env.PORT || 8787);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
