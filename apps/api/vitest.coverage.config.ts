import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.js';

// Unit + integration specs in one coverage run: database code is measured,
// not excluded. Not mergeConfig, which would keep the unit run's exclusions.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.live.test.ts'],
    // Specs share one database, so files run one at a time.
    fileParallelism: false,
    coverage: unitConfig.test?.coverage,
  },
});
