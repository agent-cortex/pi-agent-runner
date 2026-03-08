---
name: pi-agent-runner
description: Queue and execute async jobs on a Raspberry Pi via REST API + BullMQ worker, including reminders and scheduled jobs. Supports `bullmq` and `systemd` schedule backends with lifecycle controls.
---

# pi-agent-runner

Use this skill to enqueue and manage async jobs while keeping chat responsive.

## Core APIs

- `POST /jobs` — enqueue immediate or scheduled job
- `GET /jobs/:id` — inspect state/result/error
- `GET /jobs` — recent jobs
- `GET /schedules` — tracked recurring/system schedules
- `PATCH /jobs/:id` — pause/resume tracked schedules
- `DELETE /jobs/:id` — remove queued job or tracked schedule
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
  "input": {
    "title": "Hydration",
    "message": "Drink water"
  },
  "priority": 5,
  "callbackUrl": "https://example.com/callback",
  "metadata": { "requestedBy": "agent-main" },
  "scheduleBackend": "bullmq",
  "idempotencyKey": "optional-client-key",
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

Backend rules:
- `scheduleBackend: "bullmq"` (default): Redis/BullMQ scheduling
- `scheduleBackend: "systemd"`: writes manifest under `data/systemd-manifests/` for installer sync

Systemd cron support in installer:
- `M * * * *`
- `M H * * *`
- `M H * * D`

Idempotency:
- Prefer `Idempotency-Key` header
- `idempotencyKey` body field also supported

## Reminder Template

Use for intents like:
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

### Recurring reminder (systemd backend)

```bash
curl -X POST http://127.0.0.1:8787/jobs \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reminder-hydration-v1" \
  -d '{
    "jobType": "reminder",
    "scheduleBackend": "systemd",
    "input": {
      "title": "Standup",
      "message": "Daily check-in",
      "recipient": "megabyte"
    },
    "schedule": {
      "cron": "0 10 * * 1",
      "tz": "Asia/Kolkata"
    }
  }'
```

## Lifecycle operations

Pause a tracked schedule:

```bash
curl -X PATCH http://127.0.0.1:8787/jobs/<scheduleId> \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"pause"}'
```

Resume:

```bash
curl -X PATCH http://127.0.0.1:8787/jobs/<scheduleId> \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"resume"}'
```

Delete:

```bash
curl -X DELETE http://127.0.0.1:8787/jobs/<scheduleId> \
  -H "Authorization: Bearer $RUNNER_API_TOKEN"
```

## Status + Debug Flow

1. Submit job (`POST /jobs`)
2. Poll job (`GET /jobs/:id`) until `completed` or `failed`
3. Inspect:
   - `returnvalue.summary`
   - `failedReason`
   - `attemptsMade`
4. For recurring jobs, inspect `GET /schedules`
5. If callback delivery expected but missing, inspect logs:

```bash
docker logs --since 30m pi-agent-runner-callback
docker logs --since 30m pi-agent-runner-worker
```

## Operational Notes

- Worker retries job execution (`attempts: 3`, exponential backoff)
- Callback delivery retries are handled in notifier
- Reminder jobs produce concise output (`⏰ <title>: <message>`)
- `systemd` backend requires installer sync process (`apps/installer`)
- Keep secrets in env/pass; never hardcode tokens in docs/messages
