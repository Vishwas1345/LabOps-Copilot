// One-shot entrypoint: ingests the demo scenarios, for a host where the demo
// routes are off (APP_ENV=production) and nothing else creates data. Safe to
// run on every boot: a replay is recognised by its dedup keys and adds nothing.

import { prisma } from './db.js';
import { runScenario } from './modules/demo/service.js';
import type { ScenarioName } from './modules/labs/simulator.js';
import { closeQueues } from './platform/jobs/queues.js';
import { logger } from './platform/observability/logger.js';

// Between them, every path a reviewer can click through (docs/dev/DESIGN.md).
const SCENARIOS: ScenarioName[] = ['training-event', 'shared-outages'];
const SEED = 42;

async function main() {
  for (const scenario of SCENARIOS) {
    const run = await runScenario(scenario, SEED);
    logger.info({ simulated: true, ...run }, 'demo scenario seeded');
  }
}

main()
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'demo seed failed');
    process.exitCode = 1;
  })
  .finally(() => Promise.all([closeQueues(), prisma.$disconnect()]));
