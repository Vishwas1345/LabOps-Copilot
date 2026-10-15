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
    /** Set by the content-type parser; never reported before the signature is verified. */
    bodyParseFailed: boolean;
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
    /** Tests lower the delivery ceiling so a 429 is reachable in a test run. */
    deliveriesPerMinute?: number;
  },
): Promise<void> {
  // Encapsulated so the content-type parser below applies to this route only.
  // The rest of the API keeps Fastify's default JSON parsing, and nothing else
  // can read or depend on an unparsed body. The rate limiter is registered in
  // the same scope rather than reusing the login one, so this limit cannot
  // change if the auth registration is ever reordered, and so a deploy with no
  // webhook opens no extra Redis connection.
  await app.register(async (instance) => {
    const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    instance.addHook('onClose', () => redis.quit().then(() => undefined, () => undefined));
    await instance.register(rateLimit, {
      global: false,
      redis,
      nameSpace: `${options.keyPrefix}:webhook-limit:`,
      errorResponseBuilder: (_request, context) =>
        new AppError(429, 'RATE_LIMITED', `too many deliveries; retry in ${context.after}`),
    });

    instance.decorateRequest('rawBody', null);
    instance.decorateRequest('bodyParseFailed', false);

    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
      (request, body, done) => {
        const raw = typeof body === 'string' ? body : body.toString('utf8');
        request.rawBody = raw;
        try {
          done(null, JSON.parse(raw));
        } catch {
          // Recorded, not thrown. The signature covers these exact bytes, so the
          // handler verifies it first: a parse error must not become a way to
          // skip authentication, and must not go unaudited.
          request.bodyParseFailed = true;
          done(null, undefined);
        }
      },
    );

    // An oversized body is refused before the handler runs, so the audit entry
    // is written here. Failures are swallowed: an audit problem must not turn a
    // 413 into a 500 or stall the response.
    instance.addHook('onResponse', async (_request, reply) => {
      if (reply.statusCode === 413) {
        try {
          await auditRejection('body_too_large');
        } catch {
          // The delivery was refused either way; the trail is best-effort here.
        }
      }
    });

    instance.post(
      `/api/webhooks/${WEBHOOK_PROVIDER_ID}`,
      {
        config: {
          public: true,
          rateLimit: {
            max: options.deliveriesPerMinute ?? WEBHOOK_DELIVERIES_PER_MINUTE,
            timeWindow: '1 minute',
          },
        },
      },
      async (request, reply) => {
        const secret = options.secret;
        if (!secret) throw new AppError(404, 'NOT_CONFIGURED', 'webhook is not configured');

        const header = request.headers['x-labops-signature'];
        const nowSeconds = Math.floor(Date.now() / 1000);
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

        // Past authentication: only a validly-signed body can learn that it
        // failed to parse, and the attempt is on the record either way.
        if (request.bodyParseFailed) {
          await auditRejection('invalid_json');
          throw new AppError(400, 'INVALID_JSON', 'body is not valid JSON');
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