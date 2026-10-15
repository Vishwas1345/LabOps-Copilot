import { defineConfig, devices } from '@playwright/test';

// Runs against an already-running compose stack, so the journey exercises the
// built images; Playwright never starts a dev server itself (docs/infra/INFRA.md).
export default defineConfig({
  testDir: './e2e',
  // One stack, one seeded scenario: the journey's steps depend on each other.
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 45_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    // Screenshots, never traces: a trace records cookies, including the session.
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
