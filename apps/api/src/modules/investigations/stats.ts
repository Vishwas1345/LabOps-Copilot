// AI metrics, from committed investigations. Latency is what callProvider
// measured and stored in modelMetadata, not a separate timer.

import { InvestigationFailure, InvestigationStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { DurationSummary, PercentileRow } from '../../platform/observability/metrics.js';
import { countsFor, toDurationSummary } from '../../platform/observability/metrics.js';

export interface InvestigationStats {
  byStatus: Record<InvestigationStatus, number>;
  /** Why the failed ones failed: the model, the provider, or our limits. */
  failures: Record<InvestigationFailure, number>;
  latency: DurationSummary;
}

export async function investigationStats(since: Date): Promise<InvestigationStats> {
  const window = { createdAt: { gte: since } };
  const [statuses, failures, latency] = await Promise.all([
    prisma.investigation.groupBy({ by: ['status'], where: window, _count: { _all: true } }),
    prisma.investigation.groupBy({
      by: ['failure'],
      where: { ...window, failure: { not: null } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<PercentileRow[]>(Prisma.sql`
      SELECT count(ms)::int AS samples,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
      FROM (
        SELECT ("modelMetadata"->>'latencyMs')::float8 AS ms
        FROM "Investigation"
        WHERE "createdAt" >= (${since} AT TIME ZONE 'UTC')
      ) calls`),
  ]);
  return {
    byStatus: countsFor(
      Object.values(InvestigationStatus),
      statuses.map((row) => ({ key: row.status, count: row._count._all })),
    ),
    failures: countsFor(
      Object.values(InvestigationFailure),
      failures.flatMap((row) => (row.failure ? [{ key: row.failure, count: row._count._all }] : [])),
    ),
    latency: toDurationSummary(latency[0]),
  };
}
