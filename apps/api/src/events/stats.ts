// Ingest volume and the failure timeline for the metrics view, from committed
// events only.

import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import type { ErrorCategory } from '../labs/failures.js';
import { ERROR_CATEGORIES } from '../labs/failures.js';

export interface EventStats {
  /** A redelivered duplicate is never stored, so it is never counted. */
  received: number;
}

export function eventsReceivedSince(since: Date): Promise<number> {
  return prisma.operationalEvent.count({ where: { receivedAt: { gte: since } } });
}

export interface FailureSeries {
  /** Null when no failure was received in the window. */
  bucketMs: number | null;
  /** Every bucket from the first failure to the last, empty ones included. */
  buckets: { start: string; counts: Record<ErrorCategory, number> }[];
  totals: Record<ErrorCategory, number>;
}

const MINUTE = 60_000;
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * MINUTE);
const TARGET_BUCKETS = 30;
const MAX_BUCKETS = 60;

/** A readable bucket width giving about 30 buckets, and never more than 60. */
export function bucketWidth(spanMs: number): number {
  const nice = STEPS.find((step) => step >= spanMs / TARGET_BUCKETS) ?? STEPS[STEPS.length - 1];
  return Math.max(nice, Math.ceil(spanMs / MAX_BUCKETS));
}

const zeros = () =>
  Object.fromEntries(ERROR_CATEGORIES.map((category) => [category, 0])) as Record<ErrorCategory, number>;

/**
 * Failures received in the window, bucketed by when they happened (event time,
 * which is what explains an incident). The window param is a UTC instant and
 * the columns hold UTC without a zone, so it is converted explicitly (#22).
 */
export async function failureSeries(since: Date): Promise<FailureSeries> {
  const window = Prisma.sql`type = 'provision_failed' AND "receivedAt" >= (${since} AT TIME ZONE 'UTC')`;
  const [range] = await prisma.$queryRaw<[{ first: number | null; last: number | null }]>`
    SELECT EXTRACT(EPOCH FROM min("occurredAt"))::float8 * 1000 AS first,
           EXTRACT(EPOCH FROM max("occurredAt"))::float8 * 1000 AS last
    FROM "OperationalEvent" WHERE ${window}`;
  const totals = zeros();
  if (range.first === null || range.last === null) return { bucketMs: null, buckets: [], totals };

  const width = bucketWidth(range.last - range.first);
  const firstBucket = Math.floor(range.first / width);
  const rows = await prisma.$queryRaw<{ bucket: number; category: ErrorCategory; count: number }[]>`
    SELECT floor(EXTRACT(EPOCH FROM "occurredAt") * 1000 / ${width})::int AS bucket,
           "errorCategory"::text AS category,
           count(*)::int AS count
    FROM "OperationalEvent" WHERE ${window}
    GROUP BY 1, 2`;

  const buckets = Array.from({ length: Math.floor(range.last / width) - firstBucket + 1 }, (_, i) => ({
    start: new Date((firstBucket + i) * width).toISOString(),
    counts: zeros(),
  }));
  for (const row of rows) {
    buckets[row.bucket - firstBucket].counts[row.category] += row.count;
    totals[row.category] += row.count;
  }
  return { bucketMs: width, buckets, totals };
}
