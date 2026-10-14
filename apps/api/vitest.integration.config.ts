import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// *.int.test.ts against a real, migrated PostgreSQL.
// Reads apps/api/.env locally; CI sets DATABASE_URL and has no .env.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    environment: 'node',
    // Request logs drown the test output; tests that read logs set their own level.
    env: { LOG_LEVEL: 'warn' },
    include: ['src/**/*.int.test.ts'],
    // Specs share one database, so files run one at a time.
    fileParallelism: false,
  },
});
