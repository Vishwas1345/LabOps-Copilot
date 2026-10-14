// Outbox: the job row is written in the caller's transaction, then sent to
// Redis after commit. If Redis is down, the row survives and is reconciled.

import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import type { QueueName } from './queues.js';
import { getQueue, MAX_ATTEMPTS } from './queues.js';

export interface JobRecord {
  id: string;
  queue: QueueName;
  jobKey: string;
  generation: number;
}

// A short delay lets a burst of events for one key collapse into one run.
const DISPATCH_DELAY_MS = 2_000;

/** Creates the job row, or re-arms an existing one for the same key. */
export async function recordJob(
  tx: Prisma.TransactionClient,
  queue: QueueName,
  jobKey: string,
  payload: Prisma.InputJsonObject,
  traceparent: string | undefined,
): Promise<JobRecord> {
  const row = await tx.jobExecution.upsert({
    where: { jobKey },
    create: { queue, jobKey, payload, traceparent },
    update: {
      status: 'queued',
      payload,
      traceparent,
      errorSummary: null,
      generation: { increment: 1 },
    },
    select: { id: true, jobKey: true, generation: true },
  });
  return { ...row, queue };
}

/**
 * Sends the job to Redis. jobId is the idempotency key, so a duplicate send
 * while the job is waiting, delayed or active is a no-op. Finished jobs are
 * removed from Redis: history lives in Postgres, and a kept job would block
 * the next run for the same key.
 */
export async function dispatchJob(record: JobRecord): Promise<void> {
  await getQueue(record.queue).add(
    record.queue,
    { jobExecutionId: record.id, generation: record.generation },
    {
      jobId: record.jobKey,
      delay: DISPATCH_DELAY_MS,
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

/** The job row id behind a key, so callers can report a job without reading the table. */
export async function jobIdForKey(jobKey: string): Promise<string | null> {
  const row = await prisma.jobExecution.findUnique({ where: { jobKey }, select: { id: true } });
  return row?.id ?? null;
}
