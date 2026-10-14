import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const app = await buildApp({
  config: { CORS_ORIGIN: 'http://localhost:3000', DEMO_ENABLED: false },
});

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

    const response = await app.inject({ method: 'GET', url: `/api/jobs/${job.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: job.id,
      queue: 'correlate',
      status: 'queued',
    });
    expect(response.body).not.toContain('not for clients');
  });

  it('returns 404 for an unknown job', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/jobs/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('JOB_NOT_FOUND');
  });
});
