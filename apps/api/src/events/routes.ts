import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { actorOf } from '../auth/guard.js';
import { AppError } from '../http/errors.js';
import { labParams } from '../labs/schemas.js';
import { ConcurrentTransitionError, getLab, LabNotFoundError } from '../labs/service.js';
import { eventsQuery } from './schema.js';
import { ingestEvent, listLabEvents, UnknownReferenceError } from './service.js';

// An event is a small JSON document; anything bigger is refused early.
const EVENT_BODY_LIMIT_BYTES = 16 * 1024;

// HTTP only. Authorisation arrives with operator auth and provider adapters.
export function registerEventRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.post('/api/events', { bodyLimit: EVENT_BODY_LIMIT_BYTES }, async (request, reply) => {
    try {
      const result = await ingestEvent(request.body, actorOf(request));
      return reply.status(result.duplicate ? 200 : 201).send({ data: result });
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
  });

  app.get('/api/labs/:id/events', async (request) => {
    const { id } = labParams.parse(request.params);
    const query = eventsQuery.parse(request.query);
    try {
      await getLab(id);
    } catch (error) {
      if (error instanceof LabNotFoundError) {
        throw new AppError(404, 'LAB_NOT_FOUND', 'lab not found');
      }
      throw error;
    }
    const page = await listLabEvents(id, query);
    return { data: page.items, nextCursor: page.nextCursor };
  });
}
