# Job Authoring Guide

Add jobs in `packages/jobs/src/tasks/` and register them in `packages/jobs/src/registry.js`.

## Contract
Each job must:
- accept `(input, ctx)`
- return JSON-serializable result
- provide a concise `summary`
- optionally emit `artifactPath`

## Example
```js
export async function runMyJob(input, ctx) {
  return { summary: 'done', data: { ok: true } };
}
```

## Safety
- no arbitrary shell execution in v1
- validate and sanitize external inputs
- keep retries idempotent
