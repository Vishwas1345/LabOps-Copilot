import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import { signedInCookie } from '../auth/session.fixture.js';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const app = await buildApp({
  config: { ...loadConfig(), DEMO_ENABLED: false },
});
const headers = { cookie: (await signedInCookie()).cookie };

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/jobs/:id', () => {
  it('returns status from the Postgres mirror, without the payload', async () => {
    const job = await prisma.jobExecution.create({
      data: {
        queue: 'correlate',
        jobKey: `route-${randomUUID()}`,
        payload: { internal: 'not for clients' },
      },
    });

    const response = await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: job.id,
      queue: 'correlate',
      status: 'queued',
    });
    expect(response.body).not.toContain('not for clients');
  });

  it('returns 404 for an unknown job', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/jobs/nope', headers });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('JOB_NOT_FOUND');
  });
});
