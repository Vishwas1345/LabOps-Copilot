import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { failureSeries } from '../events/stats.js';
import { metricsQuery } from './schemas.js';
import { collectMetrics } from './service.js';

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
