import cors from '@fastify/cors';
import Fastify from 'fastify';
import type pino from 'pino';
import type { Config } from './config/env.js';
import { prisma } from './db.js';
import { registerErrorHandling } from './http/errors.js';
import { logger as defaultLogger } from './observability/logger.js';

// No endpoint accepts more than a small JSON document; a tight global limit
// turns an oversized or abusive body into a 413 before it is parsed.
const BODY_LIMIT_BYTES = 64 * 1024;

// `logger: true` would make Fastify build its own Pino instance without our
// redaction, so every `request.log` call would bypass it. Passing the shared
// instance keeps one logger with one set of rules.
export async function buildApp(options: {
  config: Pick<Config, 'CORS_ORIGIN'>;
  logger?: pino.Logger;
}) {
  const app = Fastify({
    loggerInstance: options.logger ?? defaultLogger,
    bodyLimit: BODY_LIMIT_BYTES,
  });

  registerErrorHandling(app);

  await app.register(cors, { origin: options.config.CORS_ORIGIN });

  app.get('/health', async () => {
    let database: 'up' | 'down' = 'down';

    try {
      await prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      service: 'labops-api',
      status: database === 'up' ? 'ok' : 'degraded',
      checks: { database },
    };
  });

  app.get('/api/labs', async () => {
    const labs = await prisma.lab.findMany({ orderBy: { createdAt: 'desc' } });
    return { items: labs };
  });

  return app;
}
