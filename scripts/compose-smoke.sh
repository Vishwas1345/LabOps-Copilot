#!/usr/bin/env bash
# Checks a running compose stack end to end: migrations applied, API healthy,
# and the web page reaching the API from inside its container.
set -euo pipefail

API_URL="${API_URL:-http://localhost:4000}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
ATTEMPTS="${SMOKE_ATTEMPTS:-60}"

# Polls until the command succeeds; containers need a few seconds to boot.
wait_for() {
  local label="$1"; shift
  for _ in $(seq 1 "$ATTEMPTS"); do
    if "$@" >/dev/null 2>&1; then echo "ok: $label"; return 0; fi
    sleep 2
  done
  echo "FAILED: $label" >&2
  return 1
}

migrate_exit="$(docker compose ps -a migrate --format '{{.ExitCode}}')"
[ "$migrate_exit" = "0" ] || { echo "FAILED: migrate exited $migrate_exit" >&2; exit 1; }
echo "ok: migrations applied"

wait_for "api /health reports ok" \
  sh -c "curl -fs '$API_URL/health' | grep -q '\"status\":\"ok\"'"

# React splits the text with a comment marker, hence the optional <!-- -->.
wait_for "web page shows API ok" \
  sh -c "curl -fs '$WEB_URL' | grep -Eq 'API: (<!-- -->)?ok'"

# The demo is enabled in compose: run the scenario (201, or 200 on a replay)
# and confirm ingestion moved labs, i.e. the whole event path works in the stack.
body="$(mktemp)"
status="$(curl -s -o "$body" -w '%{http_code}' -X POST \
  -H 'content-type: application/json' -d '{"seed":42}' \
  "$API_URL/api/demo/scenarios/training-event")"
case "$status" in
  200|201) echo "ok: demo scenario ran ($status)" ;;
  *) echo "FAILED: demo scenario returned $status" >&2; cat "$body" >&2; exit 1 ;;
esac

failed="$(curl -fs "$API_URL/api/labs?status=failed&limit=100" \
  | grep -o '"status":"failed"' | wc -l | tr -d ' ')"
[ "$failed" -ge 19 ] || { echo "FAILED: expected >= 19 failed labs, got $failed" >&2; exit 1; }
echo "ok: events ingested, $failed labs failed"

# A real failure event arms a correlate job; the worker container must run it.
event_body="$(mktemp)"
curl -fs -o "$event_body" -X POST -H 'content-type: application/json' \
  -d "{\"providerEventId\":\"smoke-$(date +%s)\",\"labId\":\"sim-training-event-42-lab-01\",
       \"type\":\"provision_failed\",\"errorCategory\":\"PROVISION_TIMEOUT\",
       \"message\":\"smoke test\",\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
       \"source\":\"simulated\"}" \
  "$API_URL/api/events"
job_id="$(grep -o '"jobId":"[^"]*"' "$event_body" | cut -d'"' -f4)"
[ -n "$job_id" ] || { echo "FAILED: no job armed" >&2; cat "$event_body" >&2; exit 1; }
wait_for "worker ran job $job_id" \
  sh -c "curl -fs '$API_URL/api/jobs/$job_id' | grep -q '\"status\":\"succeeded\"'"
