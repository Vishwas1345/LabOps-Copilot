import pino from 'pino';
import { redactSecrets } from './redact.js';

/**
 * Two layers, deliberately overlapping. `formatters.log` censors secret-named
 * keys at any depth and casing (see redact.ts). The `redact` paths still cover
 * request headers, which arrive inside objects the walk does not descend into.
 *
 * Neither layer replaces redacting where data enters the system (CLAUDE.md 5);
 * they exist so a forgotten log call is caught rather than trusted.
 */
export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service: 'labops-api' },
      formatters: {
        log: redactSecrets,
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["x-webhook-secret"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      serializers: {
        err: pino.stdSerializers.err,
      },
    },
    destination,
  );
}

export const logger = createLogger();

/** Child logger carrying the correlation context every line must have. */
export function withContext(context: {
  correlationId?: string;
  traceId?: string;
  incidentId?: string;
}): pino.Logger {
  return logger.child(context);
}
