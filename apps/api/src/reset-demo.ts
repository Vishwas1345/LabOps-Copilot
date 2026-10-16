// One-shot entrypoint for a demo host: wipes the database so the boot can
// migrate and seed it fresh (deploy/start.sh). See modules/demo/reset.ts.

import { prisma } from './db.js';
import { resetAllowed, resetDemoDatabase } from './modules/demo/reset.js';
import { logger } from './platform/observability/logger.js';

async function main() {
  if (!resetAllowed(process.env)) {
    throw new Error('refusing to reset: needs DEMO_RESET_ON_BOOT=true and APP_ENV=production');
  }
  const outcome = await resetDemoDatabase(prisma);
  logger.warn({ simulated: true, outcome }, 'demo database reset');
}

main()
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'demo reset failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
