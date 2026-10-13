import cors from '@fastify/cors';
import Fastify from 'fastify';
import { prisma } from './db.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

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
