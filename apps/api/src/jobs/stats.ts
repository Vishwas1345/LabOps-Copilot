// Queue metrics, from the JobExecution mirror rather than Redis: Redis is
// transport, and its counts vanish on a flush.

import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import type { DurationSummary } from '../observability/metrics.js';
import { toDurationSummary } from '../observability/metrics.js';
import type { QueueName } from './queues.js';
import { QUEUE_NAMES } from './queues.js';

export interface QueueStats {
  queue: QueueName;
  /** Waiting or running now, whenever they were enqueued. */
  depth: number;
  succeeded: number;
  failed: number;
  /** Attempts beyond the first, across the window. */
  retries: number;
  /** Start to finish of the successful run; for `correlate`, correlation time. */
  run: DurationSummary;
  /** Enqueue to finish, including waiting and retries. */
  endToEnd: DurationSummary;
}

interface WindowRow {
  queue: string;
  succeeded: number;
  failed: number;
  retries: number;
  runSamples: number;
  totalSamples: number;
  runP50: number | null;
  runP95: number | null;
  totalP50: number | null;
  totalP95: number | null;
}

export async function queueStats(since: Date): Promise<QueueStats[]> {
  const [depth, rows] = await Promise.all([
    prisma.jobExecution.groupBy({
      by: ['queue'],
      where: { status: { in: ['queued', 'running'] } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<WindowRow[]>(Prisma.sql`
      SELECT queue,
             count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             coalesce(sum(greatest(attempts - 1, 0)), 0)::int AS retries,
             count(run_ms) FILTER (WHERE status = 'succeeded')::int AS "runSamples",
             count(total_ms) FILTER (WHERE status = 'succeeded')::int AS "totalSamples",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status = 'succeeded') AS "runP50",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status = 'succeeded') AS "runP95",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms) FILTER (WHERE status = 'succeeded') AS "totalP50",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms) FILTER (WHERE status = 'succeeded') AS "totalP95"
      FROM (
        SELECT queue, status, attempts,
               EXTRACT(EPOCH FROM "finishedAt" - "startedAt")::float8 * 1000 AS run_ms,
               EXTRACT(EPOCH FROM "finishedAt" - "createdAt")::float8 * 1000 AS total_ms
        FROM "JobExecution"
        WHERE "createdAt" >= (${since} AT TIME ZONE 'UTC')
      ) jobs
      GROUP BY queue`),
  ]);

  return QUEUE_NAMES.map((queue) => {
    const row = rows.find((candidate) => candidate.queue === queue);
    return {
      queue,
      depth: depth.find((candidate) => candidate.queue === queue)?._count._all ?? 0,
      succeeded: row?.succeeded ?? 0,
      failed: row?.failed ?? 0,
      retries: row?.retries ?? 0,
      run: toDurationSummary(row && { samples: row.runSamples, p50: row.runP50, p95: row.runP95 }),
      endToEnd: toDurationSummary(
        row && { samples: row.totalSamples, p50: row.totalP50, p95: row.totalP95 },
      ),
    };
  });
}
