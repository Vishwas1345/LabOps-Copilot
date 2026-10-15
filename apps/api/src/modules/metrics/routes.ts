import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { z } from 'zod';
import { failureSeries } from '../events/stats.js';
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

  // The dashboard's failure timeline: failures per time bucket, by category.
  app.get('/api/metrics/series', async (request) => {
    const { hours } = metricsQuery.parse(request.query);
    const since = new Date(Date.now() - hours * 3_600_000);
    return { data: { window: { hours, since: since.toISOString() }, failures: await failureSeries(since) } };
  });
}
