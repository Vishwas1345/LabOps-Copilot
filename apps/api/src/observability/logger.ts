import pino from 'pino';

/**
 * Redaction lives on the serializer rather than at each call site: a forgotten
 * `logger.info(payload)` must still be unable to emit a credential
 * (CLAUDE.md 7).
 *
 * Paths are matched case-insensitively against the key names commonly used for
 * secrets across request logs, provider payloads and job payloads.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'labops-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-webhook-secret"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.secret',
      '*.token',
      '*.apiKey',
      '*.api_key',
      '*.credential',
      '*.credentials',
      '*.encryptedCredentials',
      '*.authorization',
      'headers.authorization',
      'headers["x-api-key"]',
      '*.metadata.token',
      '*.metadata.credentials',
      '*.parameters.token',
    ],
    censor: '[redacted]',
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

/** Child logger carrying the correlation context every line must have. */
export function withContext(context: {
  correlationId?: string;
  traceId?: string;
  incidentId?: string;
}): pino.Logger {
  return logger.child(context);
}