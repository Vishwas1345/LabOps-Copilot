import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.js';

/**
 * Coverage counts unit and integration specs together. Most backend code
 * talks to PostgreSQL, so a unit-only number would either fall below the
 * gate or need a growing list of exclusions, which CLAUDE.md treats as
 * disabling tests. Needs a migrated database, like test:integration.
 *
 * Built explicitly rather than with mergeConfig: mergeConfig concatenates
 * arrays, so the unit run's exclusion of *.int.test.ts would survive.
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.live.test.ts'],
    // Integration specs share one database, so files run one at a time.
    fileParallelism: false,
    // Same reporters, exclusions and 70% thresholds as the unit config.
    coverage: unitConfig.test?.coverage,
  },
});
