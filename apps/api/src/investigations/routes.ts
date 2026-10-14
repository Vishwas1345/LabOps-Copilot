import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { actorOf } from '../auth/guard.js';
import { AppError } from '../http/errors.js';
import { incidentParams } from '../incidents/schemas.js';
import { IncidentNotFoundError } from '../incidents/service.js';
import {
  InvestigationConflictError,
  listInvestigations,
  requestInvestigation,
} from './service.js';

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
export function registerInvestigationRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.post('/api/incidents/:id/investigate', async (request, reply) => {
    const { id } = incidentParams.parse(request.params);
    const result = await requestInvestigation(id, actorOf(request)).catch(mapError);
    // 202 for a new job; 200 when the active one is returned instead.
    return reply.status(result.created ? 202 : 200).send({
      data: { investigationId: result.investigationId, jobId: result.jobId },
    });
  });

  app.get('/api/incidents/:id/investigations', async (request) => {
    const { id } = incidentParams.parse(request.params);
    return { data: await listInvestigations(id).catch(mapError) };
  });
}
