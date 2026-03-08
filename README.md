# pi-agent-runner

Delegate long-running agent tasks to a Raspberry Pi and get signed webhook callbacks when each job completes.

## Main goal
Keep the main chat/session responsive by offloading async tasks (daily briefs, scraping, summarization, indexing, transforms) to a queue-backed worker running on your Pi.

---

## What’s included (v1)

- ✅ REST API to enqueue/query jobs
- ✅ Redis queue with retries (BullMQ)
- ✅ Node.js worker with allowlisted job handlers
- ✅ Signed webhook callbacks (`job.completed`, `job.failed`)
- ✅ Cron scheduler service
- ✅ Built-in pilot job: `daily-crypto-brief`
- ✅ Markdown artifacts written to local storage

---

## Architecture

- `apps/api` – Fastify API (`POST /jobs`, `GET /jobs/:id`, stats)
- `apps/worker` – BullMQ worker executes registered jobs
- `apps/scheduler` – cron triggers recurring jobs
- `packages/core` – queue + schema shared code
- `packages/jobs` – job registry + task implementations
- `packages/notifier` – webhook signing + delivery/retry
- `docs/` – quickstart, security, webhook contract, job authoring

---

## Quickstart

### 1) Configure env

```bash
cp examples/.env.example .env
# edit values:
# RUNNER_API_TOKEN=...
# WEBHOOK_SECRET=...
# CALLBACK_URL=...
```

### 2) Start stack

```bash
docker compose -f deploy/docker-compose.yml up -d
```

### 3) Submit a job

```bash
curl -X POST http://localhost:8787/jobs \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType":"daily-crypto-brief",
    "input":{"maxItems":5}
  }'
```

### 4) Check status

```bash
curl -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  http://localhost:8787/jobs/<jobId>
```

### 5) Read artifact

Artifacts are written to:

```txt
data/artifacts/
```

---

## API

### `POST /jobs`

Body:

```json
{
  "jobType": "daily-crypto-brief",
  "input": { "maxItems": 5 },
  "priority": 5,
  "callbackUrl": "https://example.com/runner-callback",
  "metadata": { "requestedBy": "agent-main" },
  "scheduleBackend": "bullmq",
  "idempotencyKey": "optional-client-key"
}
```

Supports optional `schedule`:

```json
{
  "schedule": {
    "runAt": "2026-03-10T13:30:00+05:30",
    "everySeconds": 3600,
    "cron": "0 9 * * 1-5",
    "tz": "Asia/Kolkata"
  }
}
```

Rules:
- Use only one repeat mode: `everySeconds` **or** `cron`
- `runAt` must be in the future
- `everySeconds`/`cron` create repeating jobs

Backends:
- `scheduleBackend: "bullmq"` (default) keeps scheduling inside Redis/BullMQ
- `scheduleBackend: "systemd"` writes a signed/structured manifest under `data/systemd-manifests/` for host-level timer installers
  - installer supports cron patterns: `M * * * *`, `M H * * *`, `M H * * D`

Idempotency:
- pass `Idempotency-Key` header (or body `idempotencyKey`) to dedupe retries

### `GET /jobs/:id`

Returns job state, attempts, result/error, timestamps.

### `GET /jobs`

Returns latest jobs (basic listing).

### `GET /schedules`

Returns recurring/system schedules tracked by the API (BullMQ + systemd-manifest backends).

### `PATCH /jobs/:id`

Pause/resume a tracked schedule:

- BullMQ backend: removes/re-adds repeatable schedule
- systemd backend: updates manifest `enabled` flag; installer disables/enables the corresponding timer

```json
{ "action": "pause" }
```

or

```json
{ "action": "resume" }
```

### `DELETE /jobs/:id`

Remove a queued job or tracked schedule.

- systemd backend also deletes manifest; installer prunes stale `piar-sysd-*` unit/timer files.

### `GET /queues/stats`

Returns waiting/active/completed/failed/delayed counters.

---

## Systemd Installer Service (new)

`apps/installer` polls `data/systemd-manifests/` and syncs generated unit/timer files.

### Dry-run mode (Docker default)
- writes units to `data/systemd-units/`
- does **not** call `systemctl`

### Apply mode (host)
Run installer on host with:

- `APPLY_SYSTEMD=true`
- `SYSTEMD_DIR=/etc/systemd/system`
- `INSTALLER_TOKEN` set (same value in API + installer)

The generated service triggers:
`POST /internal/systemd/trigger/:id`

That endpoint is intended for installer use only and guarded by `x-installer-token` when `INSTALLER_TOKEN` is set.

---

## Security defaults

- Bearer-token API auth
- HMAC SHA256 signed callbacks
- Bounded callback retries
- Job allowlist (no arbitrary shell execution in v1)

See `docs/security.md` and `docs/webhook-contract.md`.

---

## Daily Crypto Brief pilot

Scheduler uses `CRYPTO_BRIEF_CRON` to enqueue `daily-crypto-brief`.
Worker fetches RSS from configured crypto sources, picks latest top items, and writes:

```txt
data/artifacts/crypto-brief-YYYY-MM-DD.md
```

Then sends webhook callback with summary + artifact path.

## Reminder template

Use `jobType: "reminder"` when users ask to be reminded at a specific date/time or at a recurring frequency.

One-time reminder:

```bash
curl -X POST http://localhost:8787/jobs \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "reminder",
    "input": {
      "title": "Follow-up",
      "message": "Ping Alice about the deployment",
      "recipient": "megabyte"
    },
    "schedule": {
      "runAt": "2026-03-10T17:00:00+05:30"
    }
  }'
```

Recurring reminder (every 6 hours):

```bash
curl -X POST http://localhost:8787/jobs \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "reminder",
    "input": {
      "title": "Hydration",
      "message": "Drink water",
      "recipient": "megabyte"
    },
    "schedule": {
      "everySeconds": 21600
    }
  }'
```

When it executes, the worker completes the reminder job and callback relay forwards a concise reminder message to Telegram.

---

## Open-source roadmap (next)

- [ ] callback delivery dead-letter queue
- [ ] Postgres storage adapter (optional)
- [ ] signed callback verifier example service
- [ ] multi-job templates (web-monitor, PDF batch, digest)
- [ ] Helm/systemd deployment options

---

## License

MIT
