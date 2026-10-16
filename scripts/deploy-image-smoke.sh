#!/usr/bin/env bash
# Builds the live deploy's image (deploy/Dockerfile) and boots it the way the
# host does: 512 MB, the demo reset on, against a throwaway PostgreSQL and
# Redis. Two containers start at once on one database, as during a deploy, and
# both must serve one demo; then a container past the idle threshold must reset
# it. CI runs this before Render may deploy; it runs the same on a laptop.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="labops-deploy-smoke-$$"
IMAGE="${NAME}:test"
PORT="${SMOKE_PORT:-10001}"
# Throwaway credentials for containers that live only for this run.
OPERATOR_PASSWORD="$(openssl rand -hex 16)"
CREDENTIALS_KEY="$(openssl rand -base64 32)"

cleanup() {
  docker rm -f "${NAME}-a" "${NAME}-b" "${NAME}-c" "${NAME}-pg" "${NAME}-redis" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Captured, then searched: with pipefail, `docker logs | grep -q` fails when
# grep exits at its first match and the writer is cut off.
logs_of() { docker logs "${NAME}-$1" 2>&1; }

fail() {
  echo "FAILED: $1" >&2
  for app in a b c; do
    docker logs --tail 40 "${NAME}-${app}" >&2 2>/dev/null || true
  done
  exit 1
}

sql() { docker exec "${NAME}-pg" psql -U labops -d labops -tAc "$1"; }

echo "==> building deploy/Dockerfile"
docker build -q -f deploy/Dockerfile -t "$IMAGE" . >/dev/null

docker network create "$NAME" >/dev/null
docker run -d --name "${NAME}-pg" --network "$NAME" \
  -e POSTGRES_USER=labops -e POSTGRES_PASSWORD=labops -e POSTGRES_DB=labops \
  postgres:16-alpine >/dev/null
docker run -d --name "${NAME}-redis" --network "$NAME" \
  redis:7-alpine redis-server --maxmemory-policy noeviction >/dev/null
until docker exec "${NAME}-pg" pg_isready -U labops >/dev/null 2>&1; do sleep 1; done

# Starts container `$1` on host port `$2`; extra arguments are docker env flags.
boot() {
  local app="$1" port="$2"; shift 2
  docker run -d --name "${NAME}-${app}" --network "$NAME" \
    --memory=512m --memory-swap=512m -p "${port}:10000" \
    -e DATABASE_URL="postgresql://labops:labops@${NAME}-pg:5432/labops" \
    -e REDIS_URL="redis://${NAME}-redis:6379" \
    -e RENDER_EXTERNAL_URL="http://localhost:${port}" \
    -e SEED_OPERATOR_USERNAME=demo -e SEED_OPERATOR_PASSWORD="$OPERATOR_PASSWORD" \
    -e CREDENTIALS_KEY="$CREDENTIALS_KEY" \
    -e LLM_PROVIDER=fixture -e DEMO_RESET_ON_BOOT=true \
    "$@" "$IMAGE" >/dev/null
}

# Waits until container `$1` serves the login page with the API reachable.
wait_serving() {
  local app="$1" port="$2" page
  for _ in $(seq 1 120); do
    [ "$(docker inspect -f '{{.State.Running}}' "${NAME}-${app}")" = true ] || fail "container ${app} exited"
    page="$(curl -s "http://localhost:${port}/login" || true)"
    if grep -Eq 'API: (<!-- -->)?ok' <<<"$page"; then return 0; fi
    sleep 2
  done
  fail "container ${app} did not serve within four minutes"
}

outcome_of() { grep -oE '"outcome":"(empty|kept|reset)"' <<<"$(logs_of "$1")" | head -1 | cut -d'"' -f4; }

echo "==> two containers boot at once on one empty database, as during a deploy"
boot a "$PORT"
boot b "$((PORT + 1))"
wait_serving a "$PORT"
wait_serving b "$((PORT + 1))"
outcomes="$(printf '%s\n%s\n' "$(outcome_of a)" "$(outcome_of b)" | sort | tr '\n' ' ')"
[ "$outcomes" = "empty kept " ] || fail "expected one empty and one kept boot, got: ${outcomes}"
labs="$(sql 'SELECT count(*) FROM "Lab"')"
[ "$labs" = 40 ] || fail "expected the 40 demo labs once, found ${labs}"
head="$(curl -sI "http://localhost:${PORT}/login")"
headers="$(grep -ciE '^(x-frame-options|content-security-policy|x-content-type-options|referrer-policy|strict-transport-security):' <<<"$head")"
[ "$headers" = 5 ] || fail "expected 5 security headers, got ${headers}"
echo "ok: one boot reset, the other kept it; both serve; 40 labs; 5 security headers"

echo "==> after both stop, a boot past the idle threshold resets the demo"
docker rm -f "${NAME}-a" "${NAME}-b" >/dev/null
boot c "$PORT" -e DEMO_RESET_IDLE_MINUTES=0
wait_serving c "$PORT"
[ "$(outcome_of c)" = reset ] || fail "expected the idle demo to reset, got: $(outcome_of c)"
labs="$(sql 'SELECT count(*) FROM "Lab"')"
[ "$labs" = 40 ] || fail "expected a fresh 40 labs after the reset, found ${labs}"
echo "ok: the idle demo reset and the site came back"
echo "ok: $(docker stats --no-stream --format '{{.MemUsage}}' "${NAME}-c") in use"
