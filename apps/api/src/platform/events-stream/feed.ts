// The live feed is the tail of committed audit entries. A row is read only
// once its transaction, and every older one, has finished: below the oldest
// running transaction id (pg_snapshot_xmin). seq would not do: it follows
// insertion, and transactions commit out of seq order, so "seq > N" can skip
// a row that commits late. Boundaries are xid8 values, carried as strings.

import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

export interface FeedEvent {
  seq: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: string;
  /** The incident this entry is about, so a page can tell if it is relevant. */
  incidentId: string | null;
  createdAt: string;
}

/** Every transaction with a smaller id has finished; their rows are final. */
export async function currentBoundary(): Promise<string> {
  const [row] = await prisma.$queryRaw<[{ boundary: string }]>`
    SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS boundary`;
  return row.boundary;
}

interface FeedRow {
  seq: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: string;
  metaIncident: string | null;
  createdAt: Date;
}

/**
 * Final rows with from <= txid < to, in commit-safe order. Never metadata:
 * only the incident id is lifted out of it.
 */
export async function readFeed(from: string, to: string, limit: number): Promise<FeedEvent[]> {
  const rows = await prisma.$queryRaw<FeedRow[]>(Prisma.sql`
    SELECT seq::text AS seq, action, "targetType", "targetId", outcome,
           metadata->>'incidentId' AS "metaIncident", "createdAt"
    FROM "AuditEntry"
    WHERE txid >= ${from}::xid8 AND txid < ${to}::xid8
    ORDER BY txid, seq
    LIMIT ${limit}`);
  return rows.map((row) => ({
    seq: row.seq,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    outcome: row.outcome,
    incidentId: row.targetType === 'incident' ? row.targetId : row.metaIncident,
    createdAt: row.createdAt.toISOString(),
  }));
}
