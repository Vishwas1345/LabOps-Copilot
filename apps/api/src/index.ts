import { buildApp } from './app.js';
import { prisma } from './db.js';

async function main() {
  const app = await buildApp();
  const host = process.env.API_HOST ?? '127.0.0.1';
  const port = Number(process.env.API_PORT ?? 4000);

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host, port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
