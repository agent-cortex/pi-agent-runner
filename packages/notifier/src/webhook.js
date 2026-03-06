import crypto from 'node:crypto';

export function signPayload(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export async function sendCallback({ callbackUrl, secret, event, payload }) {
  if (!callbackUrl) throw new Error('callbackUrl missing');
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(payload);
  const signature = signPayload(secret || '', ts, body);

  const res = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-event': event,
      'x-runner-timestamp': ts,
      'x-runner-signature': signature,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`callback failed ${res.status}: ${text}`);
  }
}

export async function sendCallbackSafe({ callbackUrl, secret, event, payload }) {
  if (!callbackUrl) return;
  const attempts = Number(process.env.CALLBACK_ATTEMPTS || 3);
  const delayMs = Number(process.env.CALLBACK_RETRY_MS || 3000);

  for (let i = 1; i <= attempts; i += 1) {
    try {
      await sendCallback({ callbackUrl, secret, event, payload });
      return;
    } catch (err) {
      console.error(`[callback] attempt ${i}/${attempts} failed:`, err?.message || err);
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
