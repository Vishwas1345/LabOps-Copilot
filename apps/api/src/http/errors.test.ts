import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../app.js';
import { createLogger } from '../observability/logger.js';
import { AppError } from './errors.js';

const TEST_CONFIG = { CORS_ORIGIN: 'http://localhost:3000', DEMO_ENABLED: false };

let current: Awaited<ReturnType<typeof buildApp>> | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function appWithRoutes() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line: string) => lines.push(line) }, 'info');
  const app = await buildApp({ config: TEST_CONFIG, logger });
  current = app;

  app.get('/app-error', async () => {
    throw new AppError(409, 'CONFLICT', 'already approved', { id: 'ra-1' });
  });
  app.get('/zod-error', async () => {
    z.object({ limit: z.number().max(100) }).parse({ limit: 'sk-live-echo' });
  });
  app.get('/bug', async () => {
    throw new Error('db password is hunter2 at /srv/app/secret.ts:42');
  });
  app.post('/echo', async (request) => request.body);

  return { app, logs: () => lines.join('') };
}

describe('error envelope', () => {
  it('maps an AppError to its status, code and details', async () => {
    const { app } = await appWithRoutes();

    const response = await app.inject({ method: 'GET', url: '/app-error' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'already approved',
        requestId: expect.any(String),
        details: { id: 'ra-1' },
      },
    });
  });

  // Negative case: Zod's raw issues can echo the rejected input.
  it('maps a ZodError to 400 with path and rule only', async () => {
    const { app } = await appWithRoutes();

    const response = await app.inject({ method: 'GET', url: '/zod-error' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.details[0].path).toBe('limit');
    expect(response.body).not.toContain('sk-live-echo');
  });

  // Negative case: a bug must not leak its message, stack or file paths.
  it('hides an unexpected error behind a generic 500', async () => {
    const { app, logs } = await appWithRoutes();

    const response = await app.inject({ method: 'GET', url: '/bug' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toEqual({
      code: 'INTERNAL',
      message: 'internal server error',
      requestId: expect.any(String),
    });
    expect(response.body).not.toContain('hunter2');
    expect(response.body).not.toContain('secret.ts');
    // ...but it is logged, so it can be found from the requestId.
    expect(logs()).toContain(response.json().error.requestId);
  });

  it('returns the envelope for an unknown route', async () => {
    const { app } = await appWithRoutes();

    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('returns the envelope for malformed JSON', async () => {
    const { app } = await appWithRoutes();

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.requestId).toEqual(expect.any(String));
  });

  // Negative case: an oversized body is refused before it is parsed.
  it('rejects a body over the global limit with 413', async () => {
    const { app } = await appWithRoutes();

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(65 * 1024) }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('FST_ERR_CTP_BODY_TOO_LARGE');
  });

  it('gives every response a distinct requestId', async () => {
    const { app } = await appWithRoutes();

    const first = await app.inject({ method: 'GET', url: '/nope' });
    const second = await app.inject({ method: 'GET', url: '/nope' });

    expect(first.json().error.requestId).not.toBe(
      second.json().error.requestId,
    );
  });
});
