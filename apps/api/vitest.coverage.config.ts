import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.js';

// Unit + integration specs in one coverage run: database code is measured,
// not excluded. Not mergeConfig, which would keep the unit run's exclusions.
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
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.live.test.ts'],
    // Specs share one database, so files run one at a time.
    fileParallelism: false,
    coverage: unitConfig.test?.coverage,
  },
});
