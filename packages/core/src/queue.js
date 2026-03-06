import IORedis from 'ioredis';

export const QUEUE_NAME = 'agent-jobs';

export function createRedisConnection() {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
