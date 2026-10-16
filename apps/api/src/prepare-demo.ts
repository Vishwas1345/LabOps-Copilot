// One-shot entrypoint for a demo host (deploy/start.sh): under one boot lock,
// reset the demo if it is idle, migrate, seed the operator and the scenario.
// Holding the lock through the seeds is what lets a second container see the
// first one's fresh demo and keep it. See modules/demo/reset.ts.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { resetAllowed, resetDemoDatabase, withBootLock } from './modules/demo/reset.js';
import { logger } from './platform/observability/logger.js';

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

const prepareEnv = z.object({
  DATABASE_URL: z.url(),
  DEMO_RESET_IDLE_MINUTES: z.coerce.number().int().min(0).max(1440).default(10),
});

const run = (args: string[]) => execFileSync(process.execPath, args, { stdio: 'inherit' });

async function main() {
  if (!resetAllowed(process.env)) {
    throw new Error('refusing to prepare: needs DEMO_RESET_ON_BOOT=true and APP_ENV=production');
  }
  const env = prepareEnv.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    DEMO_RESET_IDLE_MINUTES: process.env.DEMO_RESET_IDLE_MINUTES || undefined,
  });
  // One connection, so the session lock and its unlock share it.
  const url = new URL(env.DATABASE_URL);
  url.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    await withBootLock(db, async () => {
      const idleSince = new Date(Date.now() - env.DEMO_RESET_IDLE_MINUTES * 60_000);
      const outcome = await resetDemoDatabase(db, idleSince);
      logger.warn({ simulated: true, outcome }, 'demo database reset');
      run([prismaCli, 'migrate', 'deploy']);
      run(['dist/seed-operator.js']);
      // A failed scenario seed leaves the site serving without it.
      try {
        run(['dist/seed-demo.js']);
      } catch {
        logger.error('demo seed failed; serving without it');
      }
    });
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'demo prepare failed');
  process.exitCode = 1;
});
