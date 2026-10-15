// Incident metrics, from committed incidents and the events they cite.

import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import type { DurationSummary, PercentileRow } from '../observability/metrics.js';
import { toDurationSummary } from '../observability/metrics.js';

export interface IncidentStats {
  created: number;
  /** From the earliest cited event being received to the incident existing. */
  timeToIdentify: DurationSummary;
}

export async function incidentStats(since: Date): Promise<IncidentStats> {
  const [created, rows] = await Promise.all([
    prisma.incident.count({ where: { createdAt: { gte: since } } }),
    prisma.$queryRaw<PercentileRow[]>(Prisma.sql`
      SELECT count(*)::int AS samples,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
      FROM (
        SELECT EXTRACT(EPOCH FROM i."createdAt" - min(e."receivedAt"))::float8 * 1000 AS ms
        FROM "Incident" i
        JOIN "IncidentLab" il ON il."incidentId" = i.id
        JOIN "OperationalEvent" e ON e.id = il."eventId"
        WHERE i."createdAt" >= ${since}
        GROUP BY i.id
      ) per_incident`),
  ]);
  return { created, timeToIdentify: toDurationSummary(rows[0]) };
}
