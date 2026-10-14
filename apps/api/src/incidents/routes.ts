import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { listAuditFor } from '../audit/audit.js';
import { AppError } from '../http/errors.js';
import { incidentParams, listIncidentsQuery } from './schemas.js';
import {
  assertIncidentExists,
  getIncident,
  IncidentNotFoundError,
  listIncidents,
} from './service.js';

function notFound(error: unknown): never {
  if (error instanceof IncidentNotFoundError) {
    throw new AppError(404, 'INCIDENT_NOT_FOUND', 'incident not found');
  }
  throw error;
}

// HTTP only, read-only. Authorisation arrives with operator auth (Phase 6).
export function registerIncidentRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.get('/api/incidents', async (request) => {
    const query = listIncidentsQuery.parse(request.query);
    const page = await listIncidents(query);
    return { data: page.items, nextCursor: page.nextCursor };
  });

  app.get('/api/incidents/:id', async (request) => {
    const { id } = incidentParams.parse(request.params);
    return { data: await getIncident(id).catch(notFound) };
  });

  app.get('/api/incidents/:id/audit', async (request) => {
    const { id } = incidentParams.parse(request.params);
    await assertIncidentExists(id).catch(notFound);
    return { data: await listAuditFor('incident', id) };
  });
}
