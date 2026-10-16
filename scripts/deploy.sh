#!/usr/bin/env bash
# Deploy the current main to the host this runs on. Linux only: it uses compose
# v2 and a health check over curl.
#
#   ./scripts/deploy.sh            build and roll out
#   ./scripts/deploy.sh --no-build roll out existing images
#
# Migrations run before the new containers start, because `migrate` is a
# dependency of both api and worker. That is the safe order only because every
# migration so far is additive; a migration that drops or renames a column would
# need the expand-contract sequence instead.

set -euo pipefail

cd "$(dirname "$0")/.."

BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f .env.production ]]; then
  echo "no .env.production on this host; copy .env.production.example and fill it in" >&2
  exit 1
fi

# The compose file reads .env.production, not .env, so a developer's local
# values cannot leak into a deploy by accident.
set -a
# shellcheck disable=SC1091
. ./.env.production
set +a

COMPOSE="docker compose -f docker-compose.prod.yml"

# A first deploy has no running database, and nothing to lose.
if $COMPOSE ps --status running --services | grep -qx postgres; then
  echo "==> backing up before changing anything"
  ./scripts/backup.sh
else
  echo "==> no running database yet (first deploy): nothing to back up"
fi

echo "==> building"
if [[ "$BUILD" == "1" ]]; then
  $COMPOSE build --pull
fi

echo "==> applying migrations"
# A failure here stops the deploy: bringing up new code against an old schema
# would fail at runtime anyway, and more confusingly.
$COMPOSE run --rm migrate

echo "==> starting"
$COMPOSE up -d --remove-orphans

echo "==> waiting for the API, then the proxy"
# Checked from inside the network: the proxy answers only for SITE_DOMAIN, so a
# request to 127.0.0.1 proves nothing. Two checks, so a failure names its part.
wait_for() {
  local label="$1"; shift
  for attempt in $(seq 1 30); do
    if "$@" >/dev/null 2>&1; then
      echo "    ${label} healthy after ${attempt} attempt(s)"
      return 0
    fi
    sleep 2
  done
  echo "    ${label} never became healthy; recent logs follow" >&2
  $COMPOSE logs --tail=40 api web proxy >&2
  exit 1
}
wait_for "API" $COMPOSE exec -T api node -e \
  "fetch('http://127.0.0.1:4000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
wait_for "proxy to web" $COMPOSE exec -T proxy wget -qO- --timeout=3 "http://web:3000/login"

echo "==> done"
echo "    check the site over https://${SITE_DOMAIN:?SITE_DOMAIN is not set}"
echo "    previous images are still tagged; roll back with:"
echo "      git checkout <sha> && ./scripts/deploy.sh"