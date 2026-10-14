import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // No live LLM call may ever be part of the default run (CLAUDE.md 8).
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.live.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // Unit coverage is measured over pure logic. These files are covered by
      // the integration suite instead, which does not exist yet - do not read
      // their absence here as proof they work:
      //   index.ts             process bootstrap, needs a real signal
      //   db.ts                Prisma singleton, needs a real database
      //   app.ts               route wiring, needs a real database
      // Remove an entry as soon as the module gains unit-testable behaviour.
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/db.ts',
        'src/app.ts',
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