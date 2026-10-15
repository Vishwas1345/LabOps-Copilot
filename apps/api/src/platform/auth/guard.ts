// Deny by default: every route needs a signed-in operator unless it opts out
// with `config: { public: true }`. A route that forgets is closed, not open.

import cookie from '@fastify/cookie';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { Actor } from '../audit/audit.js';
import { AppError } from '../http/errors.js';
import type { SessionOperator } from './session.js';
import { findSessionOperator, SESSION_COOKIE } from './session.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    public?: boolean;
  }
  interface FastifyRequest {
    operator: SessionOperator | null;
  }
}

export async function registerAuthGuard<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): Promise<void> {
  await app.register(cookie);
  app.decorateRequest('operator', null);

  app.addHook('onRequest', async (request) => {
    // Unmatched URLs fall through to the 404 handler; there is nothing to protect.
    if (request.routeOptions.url === undefined || request.routeOptions.config.public) return;
    const token = request.cookies[SESSION_COOKIE];
    const operator = token ? await findSessionOperator(token) : null;
    if (!operator) {
      throw new AppError(401, 'UNAUTHENTICATED', 'sign in required');
    }
    request.operator = operator;
  });
}

/** The audit actor for a request: always the session's operator, never the body. */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.operator) {
    throw new AppError(401, 'UNAUTHENTICATED', 'sign in required');
  }
  return { type: 'human', id: request.operator.id };
}
