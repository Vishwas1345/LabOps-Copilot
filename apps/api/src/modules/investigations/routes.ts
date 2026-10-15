import rateLimit from '@fastify/rate-limit';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { Redis } from 'ioredis';
import { actorOf } from '../../platform/auth/guard.js';
import { AppError } from '../../platform/http/errors.js';
import { incidentParams } from '../incidents/schemas.js';
import { IncidentNotFoundError } from '../incidents/service.js';
import {
  InvestigationConflictError,
  listInvestigations,
  requestInvestigation,
} from './service.js';

/**
 * Investigations per minute per client. This is the only route that can spend
 * money or consume a provider's quota, so it carries a ceiling even though an
 * operator rarely needs more than a handful. Unbounded is how a free-tier key
 * gets throttled to 503.
 */
const INVESTIGATIONS_PER_MINUTE = 10;

function mapError(error: unknown): never {
  if (error instanceof IncidentNotFoundError) {
    throw new AppError(404, 'INCIDENT_NOT_FOUND', 'incident not found');
  }
  if (error instanceof InvestigationConflictError) {
    throw new AppError(409, 'INCIDENT_NOT_INVESTIGABLE', 'incident cannot be investigated now');
  }
  throw error;
}

// HTTP only. The model never runs inside a request: 202 and a job id.
export async function registerInvestigationRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
  options: { redisUrl: string; keyPrefix: string },
): Promise<void> {
  // Encapsulated so this limiter cannot collide with the one the auth module
  // registers on the root instance, and so it applies only to these two routes.
  await app.register(async (instance) => {
    // Lazy, and a single connection: processes that never investigate one never
    // open it. Fails closed like sign-in, so a Redis outage refuses rather than
    // allowing unlimited model calls.
    const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    instance.addHook('onClose', () => redis.quit().then(() => undefined, () => undefined));
    await instance.register(rateLimit, {
      global: false,
      redis,
      nameSpace: `${options.keyPrefix}:investigation-limit:`,
      errorResponseBuilder: (_request, context) =>
        new AppError(429, 'RATE_LIMITED', `too many investigations; retry in ${context.after}`),
    });

    instance.post(
      '/api/incidents/:id/investigate',
      {
        config: {
          rateLimit: { max: INVESTIGATIONS_PER_MINUTE, timeWindow: '1 minute' },
        },
      },
      async (request, reply) => {
        const { id } = incidentParams.parse(request.params);
        const result = await requestInvestigation(id, actorOf(request)).catch(mapError);
        // 202 for a new job; 200 when the active one is returned instead.
        return reply.status(result.created ? 202 : 200).send({
          data: { investigationId: result.investigationId, jobId: result.jobId },
        });
      },
    );

    // Listing is cheap and not metered: an operator paging back through results
    // must not be throttled by having just investigated something.
    instance.get('/api/incidents/:id/investigations', async (request) => {
      const { id } = incidentParams.parse(request.params);
      return { data: await listInvestigations(id).catch(mapError) };
    });
  });
}