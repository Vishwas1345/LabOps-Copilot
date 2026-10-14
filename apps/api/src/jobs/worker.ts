// Builds a BullMQ worker over the runner. The process entrypoint is
// src/worker.ts; this factory exists so tests can run a real worker.

import { Worker } from 'bullmq';
import type pino from 'pino';
import type { JobMessage, QueueName } from './queues.js';
import { queuePrefix, redisConnection } from './queues.js';
import type { JobHandlers } from './runner.js';
import { redispatchIfRearmed, runJob } from './runner.js';

export function createWorker(
  queue: QueueName,
  handlers: JobHandlers,
  log: pino.Logger,
): Worker<JobMessage> {
  const worker = new Worker<JobMessage>(queue, (job) => runJob(job, handlers, log), {
    connection: redisConnection(),
    prefix: queuePrefix(),
  });
  worker.on('completed', (job) => {
    redispatchIfRearmed(job.data).catch((error: unknown) =>
      log.error({ err: error, jobId: job.id }, 'redispatch after completion failed'),
    );
  });
  return worker;
}
