#!/usr/bin/env bash
# Runs the api integration suite twice against a brand-new database, then
# drops it. Proves determinism from a clean start without wiping the dev DB.
# Needs the compose postgres running: npm run db:up
set -euo pipefail
cd "$(dirname "$0")/../apps/api"

compose=(docker compose -f ../../docker-compose.yml exec -T postgres)
db="labops_clean_check_$(date +%s)"

"${compose[@]}" psql -U labops -d labops -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $db"
trap '"${compose[@]}" psql -U labops -d labops -qc "DROP DATABASE IF EXISTS $db"' EXIT

# An exported DATABASE_URL wins: the config's .env loader never overrides it.
export DATABASE_URL="postgresql://labops:labops@localhost:5432/$db"
npx prisma migrate deploy >/dev/null

for run in 1 2; do
  echo "run $run on $db:"
  npx vitest run --config vitest.integration.config.ts 2>&1 | grep -E 'Tests |FAIL'
done
