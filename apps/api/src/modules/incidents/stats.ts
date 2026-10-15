// Incident metrics, from committed incidents and the events they cite.

import { IncidentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { DurationSummary, PercentileRow } from '../../platform/observability/metrics.js';
import { countsFor, toDurationSummary } from '../../platform/observability/metrics.js';

export interface IncidentStats {
  created: number;
  /** Every incident by its status right now, whatever the window. */
  byStatusNow: Record<IncidentStatus, number>;
  /** From the earliest cited event being received to the incident existing. */
  timeToIdentify: DurationSummary;
}

export async function incidentStats(since: Date): Promise<IncidentStats> {
  const [created, statuses, rows] = await Promise.all([
    prisma.incident.count({ where: { createdAt: { gte: since } } }),
    prisma.incident.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.$queryRaw<PercentileRow[]>(Prisma.sql`
      SELECT count(*)::int AS samples,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
      FROM (
        SELECT EXTRACT(EPOCH FROM i."createdAt" - min(e."receivedAt"))::float8 * 1000 AS ms
        FROM "Incident" i
        JOIN "IncidentLab" il ON il."incidentId" = i.id
        JOIN "OperationalEvent" e ON e.id = il."eventId"
        WHERE i."createdAt" >= (${since} AT TIME ZONE 'UTC')
        GROUP BY i.id
      ) per_incident`),
  ]);
  return {
    created,
    byStatusNow: countsFor(
      Object.values(IncidentStatus),
      statuses.map((row) => ({ key: row.status, count: row._count._all })),
    ),
    timeToIdentify: toDurationSummary(rows[0]),
  };
}
