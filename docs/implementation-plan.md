# Implementation Plan (Open-Source Friendly)

## Objective
Build a Raspberry Pi-based async job runner for AI agents:
- delegate background tasks to Pi
- keep main chat free
- send webhook notification on completion/failure

## Phase breakdown

### Phase 0 — Foundations (done)
- [x] Monorepo-like layout for api/worker/scheduler + shared packages
- [x] Docker Compose stack
- [x] Env-driven config
- [x] Basic docs and quickstart

### Phase 1 — Core async execution (done)
- [x] Redis queue with BullMQ
- [x] Job submission/status API
- [x] Worker with retries and concurrency
- [x] Signed callback delivery with retry

### Phase 2 — Pilot job: daily crypto brief (done)
- [x] RSS ingestion from multiple sources
- [x] Select latest top N items
- [x] Artifact generation (markdown)
- [x] Callback payload includes summary + artifact path

### Phase 3 — Hardening (next)
- [ ] callback dead-letter queue after max retries
- [ ] request idempotency keys (avoid duplicate job submissions)
- [ ] API rate limiting
- [ ] persistent job metadata store adapter (optional Postgres)
- [ ] unit + integration tests

### Phase 4 — OSS polish (next)
- [ ] contribution guide + issue templates
- [ ] one-command demo script
- [ ] verified callback receiver example
- [ ] architecture diagrams

## Standard for community adoption

1. **Simple install**
   - compose up, copy env, submit job in <10 min
2. **Safe defaults**
   - no arbitrary shell, signed callbacks, retries bounded
3. **Extensible jobs**
   - documented job contract + registry model
4. **Observable**
   - queue stats + job inspection endpoints

## Pilot workflow for your stack

1. Scheduler enqueues `daily-crypto-brief`
2. Worker processes and writes `data/artifacts/crypto-brief-YYYY-MM-DD.md`
3. Callback sent to your automation endpoint
4. Main agent posts final summary in chat

## Definition of done for “project ready”
- [x] End-to-end job flow in Pi environment
- [x] Daily crypto brief pipeline functional
- [x] Callback contract/documentation ready for integration
- [ ] Callback receiver integrated into your production agent endpoint
- [ ] 7-day reliability run with metrics and no critical failures
