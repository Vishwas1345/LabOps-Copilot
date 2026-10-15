// Signed provider webhooks: the only route that accepts data from a system we
// do not control. It authenticates by HMAC over the raw body rather than a
// session, and every failure returns one generic 401, so a caller cannot learn
// which check it failed.

import rateLimit from '@fastify/rate-limit';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { Redis } from 'ioredis';
import { prisma } from '../../db.js';
import type { Actor } from '../../platform/audit/audit.js';
import { writeAudit } from '../../platform/audit/audit.js';
import { AppError } from '../../platform/http/errors.js';
import { ConcurrentTransitionError } from '../labs/service.js';
import { incomingEvent } from '../events/schemas.js';
import { ingestEvent, UnknownReferenceError } from '../events/service.js';
import { verifySignature } from './signature.js';

/** An event is a small JSON document; anything bigger is refused before parsing. */
const WEBHOOK_BODY_LIMIT_BYTES = 16 * 1024;

/** A delivery is small and automatic; a provider sending thousands is not normal. */
const WEBHOOK_DELIVERIES_PER_MINUTE = 120;

export const WEBHOOK_PROVIDER_ID = 'mock-platform';

const WEBHOOK_ACTOR: Actor = { type: 'system', id: WEBHOOK_PROVIDER_ID };

declare module 'fastify' {
  interface FastifyRequest {
    /** The exact bytes received, before parsing. The signature covers these. */
    rawBody: string | null;
  }
}

async function auditRejection(reason: string): Promise<void> {
  // Reason only: the signature header and the secret never reach the trail.
  await prisma.$transaction((tx) =>
    writeAudit(tx, {
      actor: WEBHOOK_ACTOR,
      action: 'webhook.rejected',
      targetType: 'provider',
      targetId: WEBHOOK_PROVIDER_ID,
      outcome: 'rejected',
      metadata: { reason },
    }),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function registerWebhookRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
  options: {
    redisUrl: string;
    keyPrefix: string;
    /** Absent when no shared secret is configured; the route then answers 404. */
    secret?: string;
    /** Lets tests move the clock without sleeping. */
    nowSeconds?: () => number;
  },
): Promise<void> {
  // Its own rate-limit instance rather than reusing the login one: this limit
  // must not change if the auth registration is ever reordered.
  const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  app.addHook('onClose', () => redis.quit().then(() => undefined, () => undefined));
  await app.register(rateLimit, {
    global: false,
    redis,
    nameSpace: `${options.keyPrefix}:webhook-limit:`,
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', `too many deliveries; retry in ${context.after}`),
  });

  // Encapsulated so the content-type parser below applies to this route only.
  // The rest of the API keeps Fastify's default JSON parsing, and nothing else
  // can read or depend on an unparsed body.
  await app.register(async (instance) => {
    instance.decorateRequest('rawBody', null);

    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
      (request, body, done) => {
        const raw = typeof body === 'string' ? body : body.toString('utf8');
        request.rawBody = raw;
        try {
          done(null, JSON.parse(raw));
        } catch {
          done(new AppError(400, 'INVALID_JSON', 'body is not valid JSON'), undefined);
        }
      },
    );

    instance.post(
      `/api/webhooks/${WEBHOOK_PROVIDER_ID}`,
      {
        config: {
          public: true,
          rateLimit: { max: WEBHOOK_DELIVERIES_PER_MINUTE, timeWindow: '1 minute' },
        },
      },
      async (request, reply) => {
        const secret = options.secret;
        if (!secret) throw new AppError(404, 'NOT_CONFIGURED', 'webhook is not configured');

        const header = request.headers['x-labops-signature'];
        const nowSeconds = options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
        const result = verifySignature({
          rawBody: request.rawBody ?? '',
          header: typeof header === 'string' ? header : undefined,
          secret,
          nowSeconds,
        });

        if (!result.ok) {
          await auditRejection(result.reason);
          // One message for every failure: no oracle for a caller to probe.
          throw new AppError(401, 'SIGNATURE_INVALID', 'signature verification failed');
        }

        if (!isPlainObject(request.body)) {
          throw new AppError(400, 'VALIDATION_FAILED', 'body must be a JSON object');
        }

        try {
          // `source` is forced, not read: a provider may not label its own
          // events simulated. The rest of the body stays strict, so an
          // unexpected field is still a 400.
          const event = incomingEvent.parse({ ...request.body, source: 'provider' });
          const ingested = await ingestEvent(event, WEBHOOK_ACTOR);
          return reply.status(ingested.duplicate ? 200 : 201).send({ data: ingested });
        } catch (error) {
          if (error instanceof UnknownReferenceError) {
            throw new AppError(422, 'UNKNOWN_REFERENCE', `unknown ${error.field}`);
          }
          // The lab moved under us; nothing was stored, so a retry is safe.
          if (error instanceof ConcurrentTransitionError) {
            throw new AppError(409, 'CONFLICT', 'lab changed concurrently; retry');
          }
          throw error;
        }
      },
    );
  });
}