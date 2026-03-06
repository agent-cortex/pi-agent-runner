# Quickstart

## 1) Prepare env
```bash
cp examples/.env.example .env
# set RUNNER_API_TOKEN, WEBHOOK_SECRET, CALLBACK_URL
```

## 2) Start stack
```bash
docker compose -f deploy/docker-compose.yml up -d
```

## 3) Submit a job
```bash
curl -X POST http://localhost:8787/jobs \
  -H "Authorization: Bearer $RUNNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jobType":"daily-crypto-brief","input":{"maxItems":5}}'
```

## 4) Check status
```bash
curl -H "Authorization: Bearer $RUNNER_API_TOKEN" http://localhost:8787/jobs/<jobId>
```

Artifacts are saved in `data/artifacts`.
