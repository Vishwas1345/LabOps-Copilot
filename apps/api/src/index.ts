import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { prisma } from './db.js';
import { logger } from './observability/logger.js';

async function main() {
  // Throws ConfigError before anything binds; the catch below logs and exits.
  const config = loadConfig();
  const app = await buildApp({ config });

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

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'api failed to start');
  process.exit(1);
});