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
  "metadata": { "requestedBy": "agent-main" }
}
```

### `GET /jobs/:id`

Returns job state, attempts, result/error, timestamps.

### `GET /jobs`

Returns latest jobs (basic listing).

### `GET /queues/stats`

Returns waiting/active/completed/failed/delayed counters.

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
