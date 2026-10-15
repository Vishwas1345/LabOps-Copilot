import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The tsconfig `@/*` alias, which Next resolves itself but Vitest does not.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // tsconfig keeps JSX as-is for Next; tests need the automatic runtime.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/next-env.d.ts',
        // Next.js generates these; not our code to cover.
        'src/app/**/*.d.ts',
        // Server components need Next's runtime; Playwright covers them (Phase 14).
        'src/app/**/*.tsx',
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