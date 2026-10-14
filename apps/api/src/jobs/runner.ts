// Runs one job: marks the row, continues the enqueuer's trace, and records
// the outcome. The final failed attempt is audited, never just logged.

import type { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import type pino from 'pino';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import { redactText } from '../observability/redact.js';
import { withSpan, withTraceparent } from '../observability/tracing.js';
import type { JobMessage, QueueName } from './queues.js';
import { MAX_ATTEMPTS } from './queues.js';
import { dispatchJob } from './record.js';

export type JobHandler = (payload: unknown, log: pino.Logger) => Promise<unknown>;

/**
 * Runs in the transaction that marks a job failed for good, so domain state
 * left mid-flight (an investigation still `running`) is settled atomically.
 */
export type ExhaustedHook = (payload: unknown, tx: Prisma.TransactionClient) => Promise<void>;

export interface JobDefinition {
  span: string;
  handle: JobHandler;
  onExhausted?: ExhaustedHook;
}

/** A worker serves one queue, so it carries only that queue's definition. */
export type JobHandlers = Partial<Record<QueueName, JobDefinition>>;

const WORKER = { type: 'worker', id: 'labops-worker' } as const;

export async function runJob(
  job: Job<JobMessage>,
  handlers: JobHandlers,
  log: pino.Logger,
): Promise<unknown> {
  const { jobExecutionId, generation } = job.data;
  const row = await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: { status: 'running', attempts: { increment: 1 }, startedAt: new Date() },
  });
  const handler = handlers[row.queue as QueueName];
  if (!handler) {
    throw new Error(`no handler for queue ${row.queue}`);
  }
  const jobLog = log.child({ jobId: row.id, jobKey: row.jobKey, queue: row.queue });

  try {
    const result = await withTraceparent(row.traceparent, () =>
      withSpan(handler.span, (span) => {
        // Ties the span to its job row, and every log line to the trace.
        span.setAttribute('labops.job.id', row.id);
        return handler.handle(row.payload, jobLog.child({ traceId: span.spanContext().traceId }));
      }),
    );
    // Succeeded only if no newer work re-armed the row while we ran.
    await prisma.jobExecution.updateMany({
      where: { id: row.id, generation },
      data: { status: 'succeeded', finishedAt: new Date(), errorSummary: null },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary = redactText(message).slice(0, 500);
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? MAX_ATTEMPTS);

    if (finalAttempt) {
      await prisma.$transaction(async (tx) => {
        await tx.jobExecution.update({
          where: { id: row.id },
          data: { status: 'failed', finishedAt: new Date(), errorSummary: summary },
        });
        await writeAudit(tx, {
          actor: WORKER,
          action: 'job.failed',
          targetType: 'job',
          targetId: row.id,
          outcome: 'failed',
          metadata: { queue: row.queue, attempts: row.attempts, error: summary },
        });
        await handler.onExhausted?.(row.payload, tx);
      });
    } else {
      await prisma.jobExecution.update({
        where: { id: row.id },
        data: { status: 'queued', errorSummary: summary },
      });
    }
    jobLog.warn({ attempt: job.attemptsMade + 1, finalAttempt, error: summary }, 'job failed');
    throw error;
  }
}

/** After a run completes: if the row was re-armed meanwhile, run it again. */
export async function redispatchIfRearmed(message: JobMessage): Promise<void> {
  const row = await prisma.jobExecution.findUnique({ where: { id: message.jobExecutionId } });
  if (row && row.status === 'queued' && row.generation > message.generation) {
    await dispatchJob({
      id: row.id,
      queue: row.queue as QueueName,
      jobKey: row.jobKey,
      generation: row.generation,
    });
  }
}
