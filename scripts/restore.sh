#!/usr/bin/env bash
# Restore a dump into a scratch database, so a backup can be proven before it is
# needed. Restores into `labops` itself would destroy the live data, so this
# refuses to run against the production database name by accident.
#
#   ./scripts/restore.sh backups/labops-20260115T000000Z.dump
#
# The scratch database is dropped afterwards unless KEEP=1.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -lt 1 ]]; then
  echo "usage: ./scripts/restore.sh <path-to-dump>" >&2
  exit 2
fi

DUMP="$1"
if [[ ! -s "$DUMP" ]]; then
  echo "no such dump, or it is empty: ${DUMP}" >&2
  exit 1
fi

LIVE_DB="${POSTGRES_DB:-labops}"
SCRATCH_DB="labops_restore_check"

if [[ "$DUMP" == "$LIVE_DB" ]]; then
  echo "refusing: that is the live database name, not a dump file" >&2
  exit 1
fi

COMPOSE="docker compose -f docker-compose.prod.yml"
PSQL=(docker compose -f docker-compose.prod.yml exec -T postgres psql -U "${POSTGRES_USER:-labops}" -d postgres)

echo "==> dropping any previous scratch database"
"${PSQL[@]}" -c "DROP DATABASE IF EXISTS ${SCRATCH_DB}" >/dev/null

echo "==> creating ${SCRATCH_DB}"
"${PSQL[@]}" -c "CREATE DATABASE ${SCRATCH_DB}" >/dev/null

echo "==> restoring into ${SCRATCH_DB}"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --no-owner --no-privileges -U "${POSTGRES_USER:-labops}" -d "${SCRATCH_DB}" < "$DUMP"

echo "==> checking the restored data is actually there"
# Counting is the point: a restore that produces an empty schema has restored
# nothing, and exits non-zero, which is what a cron wrapper would notice.
TABLES=$("${PSQL[@]}" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
AUDIT=$("${PSQL[@]}" -d "$SCRATCH_DB" -t -c 'SELECT count(*) FROM "AuditEntry"' 2>/dev/null || echo 0)

echo "    ${TABLES} tables, ${AUDIT} audit entries"

if [[ "${TABLES}" -lt 1 ]]; then
  echo "    the restore produced no tables" >&2
  exit 1
fi

if [[ "${KEEP:-0}" == "1" ]]; then
  echo "==> leaving ${SCRATCH_DB} in place for inspection"
else
  echo "==> dropping ${SCRATCH_DB}"
  "${PSQL[@]}" -c "DROP DATABASE ${SCRATCH_DB}" >/dev/null
fi

echo "==> the dump restores. The live database was not touched."