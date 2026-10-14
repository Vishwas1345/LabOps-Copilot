import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Never a live LLM call; integration specs run under their own config.
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
      // Coverage counts integration specs too (vitest.coverage.config.ts), so
      // only process bootstrap, which no test runs, is excluded.
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