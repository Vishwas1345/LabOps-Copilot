import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { AppError } from '../http/errors.js';
import { labParams, listLabsQuery } from './schemas.js';
import { getLab, LabNotFoundError, listLabs } from './service.js';

// HTTP only: validate, delegate to the service, shape the response.
// Authorisation arrives with operator auth (Phase 6).
export function registerLabRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.get('/api/labs', async (request) => {
    const query = listLabsQuery.parse(request.query);
    const page = await listLabs(query);
    return { data: page.items, nextCursor: page.nextCursor };
  });

  app.get('/api/labs/:id', async (request) => {
    const { id } = labParams.parse(request.params);
    try {
      return { data: await getLab(id) };
    } catch (error) {
      if (error instanceof LabNotFoundError) {
        throw new AppError(404, 'LAB_NOT_FOUND', 'lab not found');
      }
      throw error;
    }
  });
}
