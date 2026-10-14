import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Integration specs (`*.int.test.ts`) run against a real PostgreSQL with
 * migrations applied: `npm run db:up && npm run db:migrate` locally, service
 * containers in CI.
 */

// Locally DATABASE_URL comes from apps/api/.env. In CI the job sets it and
// there is no .env, so nothing is loaded. Node's built-in loader avoids a
// dotenv dependency.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    // Specs share one database, so files run one at a time.
    fileParallelism: false,
  },
});
