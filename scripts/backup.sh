#!/usr/bin/env bash
# Dump Postgres to ./backups before anything else runs. There is no managed
# backup in this stack, so this file is the only copy of the audit trail.
#
# Retention keeps the seven most recent daily dumps and drops the rest, so a
# long-lived host cannot fill its own disk with backups of nothing.

set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="./backups"
KEEP=7
mkdir -p "$BACKUP_DIR"

# A dated name sorts chronologically, which the prune step relies on.
NAME="labops-$(date -u +%Y%m%dT%H%M%SZ).dump"
TARGET="${BACKUP_DIR}/${NAME}"

echo "==> dumping to ${TARGET}"
# Plain format: readable without pg_restore, and restorable by any later major
# version. Custom format would compress better but needs pg_restore to read.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump --clean --if-exists --no-owner --no-privileges \
  -U "${POSTGRES_USER:-labops}" -d "${POSTGRES_DB:-labops}" > "$TARGET"

if [[ ! -s "$TARGET" ]]; then
  echo "    the dump is empty; refusing to continue" >&2
  rm -f "$TARGET"
  exit 1
fi

chmod 600 "$TARGET"

echo "==> pruning all but the ${KEEP} newest"
# --sort=-mtime relies on mtime, which is when the dump was written.
ls -1t "${BACKUP_DIR}"/labops-*.dump | tail -n "+$((KEEP + 1))" | while read -r old; do
  echo "    removing ${old}"
  rm -f "$old"
done

echo "==> done: $(du -h "$TARGET" | cut -f1) at ${TARGET}"
echo "    verify a restore with ./scripts/restore.sh <path-to-dump> — an untested"
echo "    backup is not a backup"