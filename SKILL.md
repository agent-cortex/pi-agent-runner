---
name: pi-agent-runner
description: Queue and execute async jobs on a Raspberry Pi via REST API + BullMQ worker, including reminders and scheduled jobs. Use when creating, scheduling, checking, or debugging jobs such as daily digests, one-time reminders, recurring reminders, and callback delivery.
---

# pi-agent-runner

Use this skill to enqueue and monitor async jobs while keeping chat responsive.

## Core APIs

- `POST /jobs` — enqueue immediate or scheduled job
- `GET /jobs/:id` — inspect state/result/error
- `GET /jobs` — recent jobs
- `GET /queues/stats` — queue counters
- Health: `GET /health`

Base URL (default): `http://127.0.0.1:8787`

Auth header (required):

```bash
Authorization: Bearer $RUNNER_API_TOKEN
```

## Supported Job Types

- `daily-crypto-brief`
- `reminder`
- `ping`

## Job Payload Contract

```json
{
  "jobType": "reminder",
  "input": {},
  "priority": 5,
  "callbackUrl": "https://example.com/callback",
  "metadata": {},
  "schedule": {
    "runAt": "2026-03-10T17:00:00+05:30",
    "everySeconds": 3600,
    "cron": "0 9 * * 1-5",
    "tz": "Asia/Kolkata"
  }
}
```

Scheduling rules:
- `runAt` must be a future ISO datetime
- Use only one repeat mode: `everySeconds` or `cron`
- Omit `schedule` for immediate execution

## Reminder Template

Use for user intents like:
- “remind me tomorrow at 9am”
- “remind me every 6 hours”
- “ping me every weekday 10am”

Required fields for `reminder`:
- `input.message` (string, non-empty)

Optional fields:
- `input.title` (default: `Reminder`)
- `input.recipient` (default: `agent-main`)

### One-time reminder

```bash
curl -X POST http://127.0.0.1:8787/jobs \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "reminder",
    "input": {
      "title": "Follow-up",
      "message": "Ping Alice about deployment",
      "recipient": "megabyte"
    },
    "schedule": { "runAt": "2026-03-10T17:00:00+05:30" }
  }'
```

### Recurring reminder (interval)

```bash
curl -X POST http://127.0.0.1:8787/jobs \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "reminder",
    "input": {
      "title": "Hydration",
      "message": "Drink water",
      "recipient": "megabyte"
    },
    "schedule": { "everySeconds": 21600 }
  }'
```

### Recurring reminder (cron)

```bash
curl -X POST http://127.0.0.1:8787/jobs \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "reminder",
    "input": {
      "title": "Standup",
      "message": "Daily check-in",
      "recipient": "megabyte"
    },
    "schedule": {
      "cron": "0 10 * * 1-5",
      "tz": "Asia/Kolkata"
    }
  }'
```

## Status + Debug Flow

1. Submit job (`POST /jobs`)
2. Poll job (`GET /jobs/:id`) until `completed` or `failed`
3. Inspect:
   - `returnvalue.summary`
   - `failedReason`
   - `attemptsMade`
4. If callback delivery expected but not visible, inspect callback service logs:

```bash
docker logs --since 30m pi-agent-runner-callback
```

## Operational Notes

- Worker retries job execution (`attempts: 3`, exponential backoff)
- Callback delivery retries are handled in notifier
- Reminder jobs produce concise output (`⏰ <title>: <message>`)
- Keep secrets in env/pass; never hardcode tokens in docs/messages
