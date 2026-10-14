import cors from '@fastify/cors';
import Fastify from 'fastify';
import type pino from 'pino';
import { prisma } from './db.js';
import { logger as defaultLogger } from './observability/logger.js';

// `logger: true` would make Fastify build its own Pino instance without our
// redaction, so every `request.log` call would bypass it. Passing the shared
// instance keeps one logger with one set of rules.
export async function buildApp(
  options: { logger?: pino.Logger } = {},
) {
  const app = Fastify({ loggerInstance: options.logger ?? defaultLogger });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  });

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
