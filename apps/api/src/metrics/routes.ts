import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { z } from 'zod';
import { collectMetrics } from './service.js';

// Capped at a week: every metric is an aggregate over the window's rows.
const metricsQuery = z
  .object({ hours: z.coerce.number().int().min(1).max(168).default(24) })
  .strict();

/** Not public: aggregates only, but still operator-only like every read. */
export function registerMetricsRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.get('/api/metrics', async (request) => {
    const { hours } = metricsQuery.parse(request.query);
    return { data: await collectMetrics(hours) };
  });
}
