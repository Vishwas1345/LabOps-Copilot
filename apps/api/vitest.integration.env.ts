import { existsSync } from 'node:fs';

// Integration and coverage runs use their own database and queue prefix, so a
// running dev worker never sees, re-sends or correlates test rows.
// Reads apps/api/.env locally; CI sets the variables and has no .env.

function databaseOf(url: string): string {
  const { host, pathname } = new URL(url);
  return `${host}${pathname}`;
}

/** Sets this process's env for a test run and returns it for test workers. */
export function integrationEnv(): Record<string, string> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const testUrl = process.env.TEST_DATABASE_URL;
  // Errors name the variables, never their values: the URLs carry a password.
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL is required for integration tests (see .env.example)');
  }
  // Tests delete rows, so they must never run against the dev database.
  const devUrl = process.env.DATABASE_URL;
  if (devUrl && databaseOf(devUrl) === databaseOf(testUrl)) {
    throw new Error('TEST_DATABASE_URL must name a different database than DATABASE_URL');
  }

  // Set here, not only in test.env: globalSetup runs in this process, and its
  // migrate and teardown must use this run's database and prefix.
  const env = {
    DATABASE_URL: testUrl,
    QUEUE_PREFIX: `labops-test-${process.pid}-${Date.now()}`,
    // Request logs drown the test output; tests that read logs set their own level.
    LOG_LEVEL: 'warn',
  };
  Object.assign(process.env, env);
  return env;
}
