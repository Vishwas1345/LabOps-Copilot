// One-shot entrypoint: ingests the demo scenario, for a host where the demo
// routes are off (APP_ENV=production) and nothing else creates data. Safe to
// run on every boot: a replay is recognised by its dedup keys and adds nothing.

import { prisma } from './db.js';
import { runScenario } from './modules/demo/service.js';
import { closeQueues } from './platform/jobs/queues.js';
import { logger } from './platform/observability/logger.js';

const SCENARIO = 'training-event';
const SEED = 42;

async function main() {
  const run = await runScenario(SCENARIO, SEED);
  logger.info({ simulated: true, ...run }, 'demo scenario seeded');
}

main()
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'demo seed failed');
    process.exitCode = 1;
  })
  .finally(() => Promise.all([closeQueues(), prisma.$disconnect()]));
