#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/home/.openclaw/workspace/pi-agent-runner"
RUNNER_API_TOKEN=$(grep '^RUNNER_API_TOKEN=' "$ROOT/.env" | head -n1 | cut -d'=' -f2-)
API="http://127.0.0.1:8787"

RESP=$(curl -sS -X POST "$API/jobs" \
  -H "Authorization: Bearer ${RUNNER_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"jobType":"daily-crypto-brief","input":{"maxItems":5}}')
JOB_ID=$(echo "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["jobId"])')

for _ in $(seq 1 30); do
  J=$(curl -sS -H "Authorization: Bearer ${RUNNER_API_TOKEN}" "$API/jobs/${JOB_ID}")
  STATE=$(echo "$J" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("state",""))')
  if [[ "$STATE" == "completed" ]]; then
    ART=$(echo "$J" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("returnvalue",{}).get("artifactPath",""))')
    echo "Daily Crypto Brief ready (job $JOB_ID)"
    HOST_ART="${ART/\/app/$ROOT}"
    if [[ -f "$HOST_ART" ]]; then
      sed -n '1,14p' "$HOST_ART"
    else
      echo "Artifact path: $ART"
    fi
    exit 0
  fi
  if [[ "$STATE" == "failed" ]]; then
    echo "Crypto brief job failed (job $JOB_ID)"
    echo "$J"
    exit 1
  fi
  sleep 2
done

echo "Timed out waiting for job $JOB_ID"
exit 1
