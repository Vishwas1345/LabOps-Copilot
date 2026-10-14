import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { actorOf } from '../auth/guard.js';
import { AppError } from '../http/errors.js';
import type { IntegrationDeps } from './service.js';
import {
  CredentialsKeyMissingError,
  deleteConnection,
  listConnections,
  saveConnection,
  testConnection,
  UnknownProviderError,
} from './service.js';
import { saveConnectionBody } from './schemas.js';

function mapError(error: unknown): never {
  if (error instanceof UnknownProviderError) {
    throw new AppError(404, 'PROVIDER_UNKNOWN', 'no such provider');
  }
  if (error instanceof CredentialsKeyMissingError) {
    // 503 rather than 400: the request was valid, this deployment cannot serve it.
    throw new AppError(503, 'CREDENTIALS_KEY_MISSING', 'credential storage is not configured');
  }
  throw error;
}

/**
 * Integration settings. Not public, so the deny-by-default guard applies to
 * every route here: an anonymous request is refused before the handler runs.
 */
export function registerIntegrationRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
  deps: IntegrationDeps,
): void {
  app.get('/api/integrations', async () => {
    return { data: await listConnections(deps).catch(mapError) };
  });

  app.put('/api/integrations/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const body = saveConnectionBody.parse(request.body);

    const data = await saveConnection(deps, provider, body, actorOf(request)).catch(mapError);
    return reply.status(200).send({ data });
  });

  app.post('/api/integrations/:provider/test', async (request) => {
    const { provider } = request.params as { provider: string };

    return { data: await testConnection(deps, provider, actorOf(request)).catch(mapError) };
  });

  app.delete('/api/integrations/:provider', async (request) => {
    const { provider } = request.params as { provider: string };

    return { data: await deleteConnection(deps, provider, actorOf(request)).catch(mapError) };
  });
}