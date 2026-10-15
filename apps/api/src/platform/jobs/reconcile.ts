// Redis is transport, not truth: rows left queued or running with no live
// job (Redis flushed, crash between commit and dispatch) are resent here.

import { writeAudit } from '../audit/audit.js';
import { prisma } from '../../db.js';
import type { QueueName } from './queues.js';
import { getQueue, MAX_ATTEMPTS } from './queues.js';
import { dispatchJob } from './record.js';
import type { ExhaustedHook } from './runner.js';

// Long enough that a row the API is about to dispatch is never touched.
export const LEASE_MS = 2 * 60_000;

// The same exhaustion hooks the workers use: a job lost for good must settle
// its domain state exactly as a job that failed its last attempt does.
export async function reconcileJobs(
  now: Date = new Date(),
  onExhausted: Partial<Record<QueueName, ExhaustedHook>> = {},
): Promise<{ redispatched: number; failed: number }> {
  const stale = await prisma.jobExecution.findMany({
    where: {
      status: { in: ['queued', 'running'] },
      updatedAt: { lt: new Date(now.getTime() - LEASE_MS) },
    },
  });

  let redispatched = 0;
  let failed = 0;
  for (const row of stale) {
    const queue = row.queue as QueueName;
    // A live job (waiting, delayed or active) is BullMQ's to manage.
    if (await getQueue(queue).getJob(row.jobKey)) continue;

    if (row.attempts >= MAX_ATTEMPTS) {
      await prisma.$transaction(async (tx) => {
        await tx.jobExecution.update({
          where: { id: row.id },
          data: { status: 'failed', finishedAt: now, errorSummary: 'lost; attempts exhausted' },
        });
        await writeAudit(tx, {
          actor: { type: 'worker', id: 'reconciler' },
          action: 'job.failed',
          targetType: 'job',
          targetId: row.id,
          outcome: 'failed',
          metadata: { queue, reason: 'lost after max attempts' },
        });
        await onExhausted[queue]?.(row.payload, tx);
      });
      failed += 1;
    } else {
      await prisma.jobExecution.update({ where: { id: row.id }, data: { status: 'queued' } });
      await dispatchJob({ id: row.id, queue, jobKey: row.jobKey, generation: row.generation });
      redispatched += 1;
    }
  }
  return { redispatched, failed };
}
