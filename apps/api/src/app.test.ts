import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createLogger } from './observability/logger.js';

const SECRET = 'sk-live-should-never-appear';
// The rate limiter connects lazily, so unit tests never reach this Redis.
const TEST_CONFIG = {
  CORS_ORIGIN: 'http://localhost:3000',
  DEMO_ENABLED: false,
  REDIS_URL: 'redis://localhost:6379',
  QUEUE_PREFIX: 'labops-unit',
};

let current: Awaited<ReturnType<typeof buildApp>> | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function appWithCapturedLogs() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line: string) => lines.push(line) }, 'info');
  const app = await buildApp({ config: TEST_CONFIG, logger });
  current = app;
  return { app, output: () => lines.join('') };
}

describe('buildApp logging', () => {
  // `logger: true` gave Fastify a private logger; this proves request logs now
  // go through the shared one (it is the only one that stamps `service`).
  it('writes request logs through the shared logger', async () => {
    const { app, output } = await appWithCapturedLogs();

    await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(output()).toContain('"service":"labops-api"');
  });

  // Negative case: a handler that carelessly logs a payload must not leak it.
  it('redacts secrets logged through request.log', async () => {
    const { app, output } = await appWithCapturedLogs();
    app.get('/probe', async (request) => {
      request.log.info({ provider: { accessToken: SECRET } }, 'probe');
      return { ok: true };
    });

    await app.inject({ method: 'GET', url: '/probe' });

    expect(output()).toContain('probe');
    expect(output()).not.toContain(SECRET);
  });
});
