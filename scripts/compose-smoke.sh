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
