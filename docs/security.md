# Security

- API auth via bearer token (`RUNNER_API_TOKEN`)
- Signed callback payloads (`WEBHOOK_SECRET`)
- Retry with bounded attempts for callbacks
- Job type allowlist in schema (`createJobSchema`)
- No secret values in logs

## Webhook Verification (receiver)
Compute `HMAC_SHA256(secret, `${timestamp}.${rawBody}`)` and compare with `X-Runner-Signature`.
Reject old timestamps to prevent replay attacks.
