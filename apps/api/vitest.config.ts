import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit specs only. Integration and live specs live in their own folders
    // and run under their own configs, so a live LLM call can never sneak in.
    include: ['test/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // Coverage counts integration specs too (vitest.coverage.config.ts), so
      // only the process entrypoints, which no test runs, are excluded.
      exclude: [
        'src/index.ts',
        'src/worker.ts',
        'src/seed-operator.ts',
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