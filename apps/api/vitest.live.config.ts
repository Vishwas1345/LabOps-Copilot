import { defineConfig } from 'vitest/config';

// *.live.test.ts: the only specs that talk to a network model. Never run by
// `npm test` - vitest.config.ts excludes them - and only reachable through
// `npm run test:live`, which the opt-in CI job calls.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.live.test.ts'],
    // No coverage thresholds here. A run that needs a network model and a
    // provider that throttles must not be able to fail the quality gate.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});