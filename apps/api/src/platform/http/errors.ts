import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { ZodError } from 'zod';

// One error shape for every response: { error: { code, message, requestId } }.
// requestId links a response to its log line; stacks never leave the process.
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

// Generic over the logger: Fastify types our Pino instance differently.
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

    // Fastify's client errors (bad JSON, body too large) have safe messages.
    const status = 'statusCode' in error ? error.statusCode : undefined;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply
        .status(status)
        .send(envelope(error.code ?? 'BAD_REQUEST', error.message, request.id));
    }

    // Anything else is a bug: log it in full, reveal nothing.
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
