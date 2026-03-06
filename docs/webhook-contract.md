# Webhook Contract

Headers:
- `X-Runner-Event`: `job.completed` | `job.failed`
- `X-Runner-Timestamp`: unix seconds
- `X-Runner-Signature`: HMAC_SHA256(secret, `${timestamp}.${rawBody}`)

Body (example):
```json
{
  "jobId": "uuid",
  "jobType": "daily-crypto-brief",
  "status": "completed",
  "startedAt": "...",
  "finishedAt": "...",
  "summary": "5-item brief generated",
  "artifactPath": "/data/artifacts/brief-YYYY-MM-DD.md"
}
```
