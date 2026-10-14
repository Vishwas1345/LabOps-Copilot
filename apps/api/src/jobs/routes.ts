import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError } from '../http/errors.js';

const params = z.object({ id: z.string().min(1).max(64) }).strict();

// Read from the Postgres mirror, so status survives a Redis flush. The job's
// payload is internal and never returned.
export function registerJobRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.get('/api/jobs/:id', async (request) => {
    const { id } = params.parse(request.params);
    const job = await prisma.jobExecution.findUnique({ where: { id } });
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'job not found');
    }
    return {
      data: {
        id: job.id,
        queue: job.queue,
        status: job.status,
        attempts: job.attempts,
        errorSummary: job.errorSummary,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      },
    };
  });
}
