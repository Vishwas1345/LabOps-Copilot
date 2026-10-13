import { buildApp } from './app.js';
import { prisma } from './db.js';
import { logger } from './observability/logger.js';

async function main() {
  const app = await buildApp();
  const host = process.env.API_HOST ?? '127.0.0.1';
  const port = Number(process.env.API_PORT ?? 4000);

  const shutdown = (signal: NodeJS.Signals) => {
    void (async () => {
      logger.info({ signal }, 'shutting down');
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    })();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host, port });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'api failed to start');
  process.exit(1);
});