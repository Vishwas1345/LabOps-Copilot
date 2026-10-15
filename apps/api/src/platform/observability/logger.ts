import pino from 'pino';
import { redactSecrets } from './redact.js';

// Safety net, not the control (secrets are stripped where data enters):
// key-name redaction at any depth, plus header paths the walk cannot reach.
export function createLogger(
  destination?: pino.DestinationStream,
  level: string = process.env.LOG_LEVEL ?? 'info',
): pino.Logger {
  return pino(
    {
      level,
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
