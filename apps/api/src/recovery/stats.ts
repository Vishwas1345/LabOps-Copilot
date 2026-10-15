// Recovery metrics, from committed actions. Approval-to-verified ends at the
// verification's own checkedAt, the moment the outcome was actually known.

import { Prisma, RecoveryActionStatus } from '@prisma/client';
import { prisma } from '../db.js';
import type { DurationSummary, PercentileRow } from '../observability/metrics.js';
import { countsFor, toDurationSummary } from '../observability/metrics.js';

export interface RecoveryStats {
  byStatus: Record<RecoveryActionStatus, number>;
  approvalToVerified: DurationSummary;
}

export async function recoveryStats(since: Date): Promise<RecoveryStats> {
  const [statuses, durations] = await Promise.all([
    prisma.recoveryAction.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    // approvedAt is a UTC timestamp without a zone; checkedAt is an ISO string.
    prisma.$queryRaw<PercentileRow[]>(Prisma.sql`
      SELECT count(*)::int AS samples,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
      FROM (
        SELECT EXTRACT(EPOCH FROM ("verificationResult"->>'checkedAt')::timestamptz
                 - ("approvedAt" AT TIME ZONE 'UTC'))::float8 * 1000 AS ms
        FROM "RecoveryAction"
        WHERE "createdAt" >= ${since}
          AND "approvedAt" IS NOT NULL
          AND "verificationResult" ? 'checkedAt'
      ) verified`),
  ]);
  return {
    byStatus: countsFor(
      Object.values(RecoveryActionStatus),
      statuses.map((row) => ({ key: row.status, count: row._count._all })),
    ),
    approvalToVerified: toDurationSummary(durations[0]),
  };
}
