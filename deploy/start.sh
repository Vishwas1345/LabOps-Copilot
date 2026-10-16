#!/bin/sh
# Boots the single-container deploy: migrate, seed, then run the API, worker
# and web app until any one of them stops.
set -eu

# Fixed here, after the platform's environment, so a dashboard setting cannot
# contradict the production checks.
export APP_ENV=production
export SESSION_COOKIE_SECURE=true
export DEMO_ENABLED=false
export TRUST_PROXY_HOPS=1
export API_HOST=127.0.0.1
export API_PORT=4000
export API_INTERNAL_URL=http://127.0.0.1:4000
export NEXT_PUBLIC_API_URL=http://127.0.0.1:4000
# Render sets RENDER_EXTERNAL_URL to the service's public https origin.
export CORS_ORIGIN="${CORS_ORIGIN:-${RENDER_EXTERNAL_URL:?RENDER_EXTERNAL_URL or CORS_ORIGIN must be set}}"

# 512 MB holds three Node processes only with each heap capped.
API_HEAP="${API_HEAP_MB:-128}"
WORKER_HEAP="${WORKER_HEAP_MB:-128}"
WEB_HEAP="${WEB_HEAP_MB:-160}"

# tini -g signals the whole group, so a stop during migration or seeding reaches
# that child too; this handler then ends the rest.
worker='' api='' web=''
stop() { kill $worker $api $web 2>/dev/null || true; }
trap 'stop; wait; exit 0' TERM INT

cd /repo/apps/api
# A demo host resets an idle demo, migrates and seeds under one boot lock, so a
# deploy's overlapping containers cannot interleave (dist/prepare-demo.js).
if [ "${DEMO_RESET_ON_BOOT:-}" = true ]; then
  node dist/prepare-demo.js
else
  node /repo/node_modules/prisma/build/index.js migrate deploy
  node dist/seed-operator.js
  # Replays add nothing; a failure leaves the site serving without the demo.
  node dist/seed-demo.js || echo 'demo seed failed; serving without it' >&2
fi

node --max-old-space-size="$WORKER_HEAP" dist/worker.js &
worker=$!
node --max-old-space-size="$API_HEAP" dist/index.js &
api=$!
(cd /repo/apps/web && exec node --max-old-space-size="$WEB_HEAP" \
  /repo/node_modules/next/dist/bin/next start -p "${PORT:-10000}" -H 0.0.0.0) &
web=$!

# Any one process stopping takes the container down, so the platform restarts
# all three together rather than serving a site with a dead worker.
while kill -0 "$worker" 2>/dev/null && kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null; do
  sleep 5
done
echo 'a process exited; stopping the container' >&2
stop
wait
exit 1
