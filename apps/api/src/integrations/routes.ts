import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { z } from 'zod';
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
import {
  connectionListResponse,
  connectionResponse,
  connectionTestResponse,
  providerParams,
  saveConnectionBody,
} from './schemas.js';

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

// Every response passes its strict schema, so a field added to a view by
// mistake (a credential) fails as a 500 instead of being sent. Not a ZodError:
// that would be reported to the client as a 400 about its own request.
function checked<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new Error('integration response failed its schema');
  return result.data;
}

/** Not public: the deny-by-default guard refuses anonymous requests first. */
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
    const data = await listConnections(deps).catch(mapError);
    return checked(connectionListResponse, { data });
  });

  app.put('/api/integrations/:provider', async (request) => {
    const { provider } = providerParams.parse(request.params);
    const body = saveConnectionBody.parse(request.body);
    const data = await saveConnection(deps, provider, body, actorOf(request)).catch(mapError);
    return checked(connectionResponse, { data });
  });

  app.post('/api/integrations/:provider/test', async (request) => {
    const { provider } = providerParams.parse(request.params);
    const data = await testConnection(deps, provider, actorOf(request)).catch(mapError);
    return checked(connectionTestResponse, { data });
  });

  app.delete('/api/integrations/:provider', async (request) => {
    const { provider } = providerParams.parse(request.params);
    const data = await deleteConnection(deps, provider, actorOf(request)).catch(mapError);
    return checked(connectionResponse, { data });
  });
}
