import 'dotenv/config';
import cron from 'node-cron';
import { Queue } from 'bullmq';
import { createRedisConnection, QUEUE_NAME } from '../../../packages/core/src/queue.js';

const connection = createRedisConnection();
const queue = new Queue(QUEUE_NAME, { connection });

const expr = process.env.CRYPTO_BRIEF_CRON || '0 9 * * *';
const tz = process.env.TZ || 'Asia/Kolkata';

async function scheduleDailyCrypto() {
  await queue.add(
    'daily-crypto-brief',
    {
      jobType: 'daily-crypto-brief',
      input: {
        maxItems: Number(process.env.CRYPTO_MAX_ITEMS || 5),
      },
      callbackUrl: process.env.CALLBACK_URL,
      metadata: { source: 'scheduler' },
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
      priority: 4,
    }
  );
  console.log('scheduled daily-crypto-brief job');
}

cron.schedule(
  expr,
  async () => {
    try {
      await scheduleDailyCrypto();
    } catch (err) {
      console.error('scheduler error', err);
    }
  },
  { timezone: tz }
);

console.log(`scheduler started cron='${expr}' tz='${tz}'`);
