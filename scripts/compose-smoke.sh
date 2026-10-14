#!/usr/bin/env bash
# Checks a running compose stack end to end: migrations applied, API healthy,
# and the web page reaching the API from inside its container.
set -euo pipefail

API_URL="${API_URL:-http://localhost:4000}"
# The operator compose seeded from the same variables (root .env or CI).
OPERATOR="${SEED_OPERATOR_USERNAME:-operator}"
: "${SEED_OPERATOR_PASSWORD:?set SEED_OPERATOR_PASSWORD (the one compose seeded)}"
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT
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

# Everything below /api needs a session; without one the API must refuse.
status="$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/labs")"
[ "$status" = "401" ] || { echo "FAILED: /api/labs without a session returned $status" >&2; exit 1; }
echo "ok: protected routes refuse anonymous requests"

# Body on stdin, not argv, so the password never shows up in `ps`.
printf '{"username":"%s","password":"%s"}' "$OPERATOR" "$SEED_OPERATOR_PASSWORD" \
  | curl -fs -c "$jar" -o /dev/null -X POST -H 'content-type: application/json' \
    --data-binary @- "$API_URL/api/auth/login" \
  || { echo "FAILED: operator sign-in" >&2; exit 1; }
echo "ok: operator signed in"

failed="$(curl -fs -b "$jar" "$API_URL/api/labs?status=failed&limit=100" \
  | grep -o '"status":"failed"' | wc -l | tr -d ' ')"
[ "$failed" -ge 19 ] || { echo "FAILED: expected >= 19 failed labs, got $failed" >&2; exit 1; }
echo "ok: events ingested, $failed labs failed"

# A real failure event arms a correlate job; the worker container must run it.
event_body="$(mktemp)"
curl -fs -b "$jar" -o "$event_body" -X POST -H 'content-type: application/json' \
  -d "{\"providerEventId\":\"smoke-$(date +%s)\",\"labId\":\"sim-training-event-42-lab-01\",
       \"type\":\"provision_failed\",\"errorCategory\":\"PROVISION_TIMEOUT\",
       \"message\":\"smoke test\",\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
       \"source\":\"simulated\"}" \
  "$API_URL/api/events"
job_id="$(grep -o '"jobId":"[^"]*"' "$event_body" | cut -d'"' -f4)"
[ -n "$job_id" ] || { echo "FAILED: no job armed" >&2; cat "$event_body" >&2; exit 1; }
wait_for "worker ran job $job_id" \
  sh -c "curl -fs -b '$jar' '$API_URL/api/jobs/$job_id' | grep -q '\"status\":\"succeeded\"'"

# Correlation ran in the worker: the scenario's 12-timeout burst is one incident.
wait_for "scenario burst correlated into one incident" \
  sh -c "curl -fs -b '$jar' '$API_URL/api/incidents?severity=high&limit=100' | grep -q '\"labCount\":12'"

# The worker investigates that incident with the fixture provider (never a live
# model). On a re-run the incident is already past investigation (409), so the
# check is that a completed investigation exists either way.
incident_id="$(curl -fs -b "$jar" "$API_URL/api/incidents?severity=high&limit=100" \
  | tr '}' '\n' | grep '"labCount":12' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
[ -n "$incident_id" ] || { echo "FAILED: no 12-lab incident to investigate" >&2; exit 1; }
status="$(curl -s -b "$jar" -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/api/incidents/$incident_id/investigate")"
case "$status" in
  200|202|409) echo "ok: investigation requested ($status)" ;;
  *) echo "FAILED: investigate returned $status" >&2; exit 1 ;;
esac
wait_for "worker completed the investigation" \
  sh -c "curl -fs -b '$jar' '$API_URL/api/incidents/$incident_id/investigations' \
    | grep -q '\"status\":\"completed\"'"
