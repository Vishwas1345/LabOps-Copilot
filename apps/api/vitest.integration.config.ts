import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// *.int.test.ts against a real, migrated PostgreSQL.
// Reads apps/api/.env locally; CI sets DATABASE_URL and has no .env.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// Set here, not only in test.env: globalSetup runs in this process, and its
// teardown must clean this run's prefix, never the real one.
const QUEUE_PREFIX = `labops-test-${process.pid}-${Date.now()}`;
process.env.QUEUE_PREFIX = QUEUE_PREFIX;

export default defineConfig({
  test: {
    environment: 'node',
    // Request logs drown the test output; tests that read logs set their own level.
    // A per-run queue prefix keeps test jobs away from any running worker.
    env: { LOG_LEVEL: 'warn', QUEUE_PREFIX },
    globalSetup: ['./vitest.integration.setup.ts'],
    include: ['src/**/*.int.test.ts'],
    // Specs share one database, so files run one at a time.
    fileParallelism: false,
  },
});
