import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.js';
import { integrationEnv } from './vitest.integration.env.js';

// Unit + integration specs in one coverage run: database code is measured,
// not excluded. Not mergeConfig, which would keep the unit run's exclusions.
export default defineConfig({
  test: {
    environment: 'node',
    env: integrationEnv(),
    globalSetup: ['./vitest.integration.setup'],
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Specs share one database, so files run one at a time.
    fileParallelism: false,
    coverage: unitConfig.test?.coverage,
  },
});
