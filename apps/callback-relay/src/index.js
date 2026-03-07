import 'dotenv/config';
import Fastify from 'fastify';
import crypto from 'node:crypto';

const app = Fastify({ logger: true });

function verifySignature(secret, ts, rawBody, signature) {
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || '', 'utf8'));
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}

app.post('/callback', async (req, reply) => {
  const ts = req.headers['x-runner-timestamp'];
  const sig = req.headers['x-runner-signature'];
  const event = req.headers['x-runner-event'];
  const rawBody = JSON.stringify(req.body || {});

  const secret = process.env.WEBHOOK_SECRET || '';
  if (secret) {
    if (!ts || !sig || !verifySignature(secret, String(ts), rawBody, String(sig))) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }
  }

  const payload = req.body || {};
  const msg = event === 'job.completed'
    ? payload.jobType === 'reminder'
      ? `${payload.summary || '⏰ Reminder'}`
      : `✅ ${payload.jobType} done\n${payload.summary || ''}\nartifact: ${payload.artifactPath || 'n/a'}`
    : `❌ ${payload.jobType || 'job'} failed\n${payload.error || 'unknown error'}`;

  await sendTelegram(msg);
  return { ok: true };
});

const port = Number(process.env.CALLBACK_PORT || 9999);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
