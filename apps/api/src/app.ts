import cors from '@fastify/cors';
import Fastify from 'fastify';
import type pino from 'pino';
import { registerAuthGuard } from './auth/guard.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { Config } from './config/env.js';
import { prisma } from './db.js';
import { registerDemoRoutes } from './demo/routes.js';
import { registerEventRoutes } from './events/routes.js';
import { registerErrorHandling } from './http/errors.js';
import { closeQueues } from './jobs/queues.js';
import { registerIncidentRoutes } from './incidents/routes.js';
import { registerJobRoutes } from './jobs/routes.js';
import { registerLabRoutes } from './labs/routes.js';
import { logger as defaultLogger } from './observability/logger.js';

// No endpoint needs more; oversized bodies get a 413 before parsing.
const BODY_LIMIT_BYTES = 64 * 1024;

// Share our logger: `logger: true` would create a second one without redaction.
export async function buildApp(options: {
  config: Pick<Config, 'CORS_ORIGIN' | 'DEMO_ENABLED' | 'REDIS_URL' | 'QUEUE_PREFIX'> &
    Partial<Pick<Config, 'SESSION_COOKIE_SECURE'>>;
  logger?: pino.Logger;
}) {
  const app = Fastify({
    loggerInstance: options.logger ?? defaultLogger,
    bodyLimit: BODY_LIMIT_BYTES,
  });

  registerErrorHandling(app);

  await app.register(cors, { origin: options.config.CORS_ORIGIN });
  await registerAuthGuard(app);
  await registerAuthRoutes(app, {
    redisUrl: options.config.REDIS_URL,
    keyPrefix: options.config.QUEUE_PREFIX,
    secureCookie: options.config.SESSION_COOKIE_SECURE ?? true,
  });

  app.get('/health', { config: { public: true } }, async () => {
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

  registerLabRoutes(app);
  registerEventRoutes(app);
  registerJobRoutes(app);
  registerIncidentRoutes(app);
  app.addHook('onClose', closeQueues);
  if (options.config.DEMO_ENABLED) {
    registerDemoRoutes(app);
  }

  return app;
}
