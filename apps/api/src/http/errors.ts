import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { ZodError } from 'zod';

/**
 * One error shape for every response (CLAUDE.md 7):
 *   { error: { code, message, requestId } }
 * A client branches on `code`; `requestId` lets an operator find the matching
 * log line. Stack traces and internal messages never leave the process.
 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/** An error the API raises on purpose, with a status and a stable code. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function envelope(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    error: details === undefined
      ? { code, message, requestId }
      : { code, message, requestId, details },
  };
}

// Generic over the logger because the app is built with our Pino instance,
// which Fastify types differently from its base logger.
export function registerErrorHandling<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
): void {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(envelope(error.code, error.message, request.id, error.details));
    }

    // Path and rule only; Zod issues can echo the rejected input otherwise.
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return reply
        .status(400)
        .send(envelope('VALIDATION_FAILED', 'request is invalid', request.id, details));
    }

    // Fastify's own client errors (malformed JSON, body too large) carry a
    // 4xx status and a safe message; keep both.
    const status = 'statusCode' in error ? error.statusCode : undefined;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply
        .status(status)
        .send(envelope(error.code ?? 'BAD_REQUEST', error.message, request.id));
    }

    // Anything else is a bug. Log it in full, return nothing about it.
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send(envelope('INTERNAL', 'internal server error', request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send(envelope('NOT_FOUND', 'route not found', request.id));
  });
}
