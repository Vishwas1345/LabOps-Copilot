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

# One database per call; -d is never repeated, so there is no doubt which one runs it.
psql_in() {
  local db="$1"; shift
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-labops}" -d "$db" "$@"
}

echo "==> dropping any previous scratch database"
psql_in postgres -c "DROP DATABASE IF EXISTS ${SCRATCH_DB}" >/dev/null

echo "==> creating ${SCRATCH_DB}"
psql_in postgres -c "CREATE DATABASE ${SCRATCH_DB}" >/dev/null

echo "==> restoring into ${SCRATCH_DB}"
# backup.sh writes plain SQL, which psql replays; pg_restore reads only the
# custom and directory formats and would refuse it.
psql_in "$SCRATCH_DB" -q < "$DUMP" >/dev/null

echo "==> checking the restored data is actually there"
# Counting is the point: a restore that produces an empty schema has restored
# nothing, and exits non-zero, which is what a cron wrapper would notice.
TABLES=$(psql_in "$SCRATCH_DB" -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
AUDIT=$(psql_in "$SCRATCH_DB" -tA -c 'SELECT count(*) FROM "AuditEntry"')

echo "    ${TABLES} tables, ${AUDIT} audit entries"

if [[ "${TABLES}" -lt 1 ]]; then
  echo "    the restore produced no tables" >&2
  exit 1
fi

if [[ "${KEEP:-0}" == "1" ]]; then
  echo "==> leaving ${SCRATCH_DB} in place for inspection"
else
  echo "==> dropping ${SCRATCH_DB}"
  psql_in postgres -c "DROP DATABASE ${SCRATCH_DB}" >/dev/null
fi

echo "==> the dump restores. The live database was not touched."