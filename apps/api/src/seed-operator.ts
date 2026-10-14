// One-shot entrypoint: creates or resets the demo operator from the
// environment. Run after migrations (compose chains it to `migrate`).

import { z } from 'zod';
import { seedOperator } from './auth/service.js';
import { prisma } from './db.js';
import { logger } from './observability/logger.js';

// Unset password means "no operator": the stack still boots, nobody can sign in.
const seedEnv = z.object({
  SEED_OPERATOR_USERNAME: z.string().min(1).max(64).default('operator'),
  SEED_OPERATOR_PASSWORD: z.string().min(12).max(256).optional(),
});

async function main() {
  const env = seedEnv.parse({
    SEED_OPERATOR_USERNAME: process.env.SEED_OPERATOR_USERNAME || undefined,
    SEED_OPERATOR_PASSWORD: process.env.SEED_OPERATOR_PASSWORD || undefined,
  });
  if (!env.SEED_OPERATOR_PASSWORD) {
    logger.warn('SEED_OPERATOR_PASSWORD is unset; no operator seeded');
    return;
  }
  const outcome = await seedOperator(env.SEED_OPERATOR_USERNAME, env.SEED_OPERATOR_PASSWORD);
  logger.info({ username: env.SEED_OPERATOR_USERNAME, outcome }, 'operator seeded');
}

main()
  .catch((error: unknown) => {
    // Zod issues name the variable and the rule, never the value.
    logger.fatal({ err: error }, 'operator seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
