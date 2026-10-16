#!/usr/bin/env bash
# Builds the live deploy's image (deploy/Dockerfile) and boots it the way the
# host does: 512 MB, the demo reset on, against a throwaway PostgreSQL and
# Redis. Then restarts it, so the reset of a seeded database is exercised too.
# CI runs this before Render may deploy; it runs the same on a laptop.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="labops-deploy-smoke-$$"
IMAGE="${NAME}:test"
PORT="${SMOKE_PORT:-10001}"
# Throwaway credentials for containers that live only for this run.
OPERATOR_PASSWORD="$(openssl rand -hex 16)"

cleanup() {
  docker rm -f "${NAME}-app" "${NAME}-pg" "${NAME}-redis" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Captured, then searched: with pipefail, `docker logs | grep -q` fails when
# grep exits at its first match and the writer is cut off.
app_logs() { docker logs "${NAME}-app" 2>&1; }

fail() {
  echo "FAILED: $1" >&2
  docker logs --tail 60 "${NAME}-app" >&2 2>/dev/null || true
  exit 1
}

echo "==> building deploy/Dockerfile"
docker build -q -f deploy/Dockerfile -t "$IMAGE" . >/dev/null

docker network create "$NAME" >/dev/null
docker run -d --name "${NAME}-pg" --network "$NAME" \
  -e POSTGRES_USER=labops -e POSTGRES_PASSWORD=labops -e POSTGRES_DB=labops \
  postgres:16-alpine >/dev/null
docker run -d --name "${NAME}-redis" --network "$NAME" \
  redis:7-alpine redis-server --maxmemory-policy noeviction >/dev/null
until docker exec "${NAME}-pg" pg_isready -U labops >/dev/null 2>&1; do sleep 1; done

echo "==> booting it as the host does (512 MB, demo reset on)"
docker run -d --name "${NAME}-app" --network "$NAME" \
  --memory=512m --memory-swap=512m -p "${PORT}:10000" \
  -e DATABASE_URL="postgresql://labops:labops@${NAME}-pg:5432/labops" \
  -e REDIS_URL="redis://${NAME}-redis:6379" \
  -e RENDER_EXTERNAL_URL="http://localhost:${PORT}" \
  -e SEED_OPERATOR_USERNAME=demo -e SEED_OPERATOR_PASSWORD="$OPERATOR_PASSWORD" \
  -e CREDENTIALS_KEY="$(openssl rand -base64 32)" \
  -e LLM_PROVIDER=fixture -e DEMO_RESET_ON_BOOT=true \
  "$IMAGE" >/dev/null

# Waits until the boot has seeded the demo `count` times in total.
wait_for_seed() {
  local count="$1"
  for _ in $(seq 1 120); do
    [ "$(docker inspect -f '{{.State.Running}}' "${NAME}-app")" = true ] || fail "the container exited"
    logs="$(app_logs)"
    if [ "$(grep -c 'demo scenario seeded' <<<"$logs")" -ge "$count" ]; then
      return 0
    fi
    sleep 2
  done
  fail "the demo was not seeded within four minutes"
}

check_site() {
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/login")"
  [ "$status" = 200 ] || fail "the login page answered ${status}"
  local page
  page="$(curl -s "http://localhost:${PORT}/login")"
  grep -Eq 'API: (<!-- -->)?ok' <<<"$page" || fail "the web app cannot reach the API"
}

wait_for_seed 1
grep -q '"outcome":"empty"' <<<"$(app_logs)" || fail "the first boot did not see an empty database"
check_site
head="$(curl -sI "http://localhost:${PORT}/login")"
headers="$(grep -ciE '^(x-frame-options|content-security-policy|x-content-type-options|referrer-policy|strict-transport-security):' <<<"$head")"
[ "$headers" = 5 ] || fail "expected 5 security headers, got ${headers}"
echo "ok: first boot seeded, login 200, API ok, 5 security headers"

echo "==> restarting: the boot must reset the seeded database and come back"
docker restart "${NAME}-app" >/dev/null
wait_for_seed 2
grep -q '"outcome":"reset"' <<<"$(app_logs)" || fail "the restart did not reset the demo"
check_site
echo "ok: restart reset the demo and the site came back"
echo "ok: $(docker stats --no-stream --format '{{.MemUsage}}' "${NAME}-app") in use"
