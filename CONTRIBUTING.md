# Contributing

## Adding a new job type

1. Create handler in `packages/jobs/src/tasks/your-job.js`
2. Register in `packages/jobs/src/registry.js`
3. Add job type string to schema allowlist in `packages/core/src/schemas.js`
4. Document input/output in `docs/job-authoring.md`
5. Test locally: submit via API, verify artifact + callback

## Code style
- ESM (`import/export`)
- No TypeScript in v1 (keep barrier low)
- Prefer built-in Node APIs over heavy deps

## Pull requests
- One job per PR preferred
- Include a test submission example
- Update docs if adding config keys
