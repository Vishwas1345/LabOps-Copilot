import { defineConfig } from 'vitest/config';
import { integrationEnv } from './vitest.integration.env.js';

// *.int.test.ts against a real, migrated PostgreSQL and Redis.
export default defineConfig({
  test: {
    environment: 'node',
    env: integrationEnv(),
    globalSetup: ['./vitest.integration.setup.ts'],
    include: ['src/**/*.int.test.ts'],
    // Specs share one database, so files run one at a time.
    fileParallelism: false,
  },
});
