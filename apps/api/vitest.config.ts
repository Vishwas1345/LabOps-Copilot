import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // No live LLM call may ever be part of the default run (CLAUDE.md 8).
    // Integration specs need a real database; they run under
    // vitest.integration.config.ts, never in the unit run.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/**/*.live.test.ts',
      'src/**/*.int.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // `npm run coverage` uses vitest.coverage.config.ts, which reuses these
      // settings but counts unit and integration specs together, so code that
      // needs a real database is measured rather than excluded. The one file
      // left out is process bootstrap, which no test runs:
      //   index.ts             reads env, binds a port, handles signals
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});