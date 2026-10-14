import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const app = await buildApp({
  config: { CORS_ORIGIN: 'http://localhost:3000', DEMO_ENABLED: false },
});
const lab = await prisma.lab.create({ data: { name: 'events-routes-test' } });

afterAll(async () => {
  await prisma.lab.delete({ where: { id: lab.id } });
  await app.close();
  await prisma.$disconnect();
});

const event = (overrides: Record<string, unknown> = {}) => ({
  providerEventId: randomUUID(),
  labId: lab.id,
  type: 'provision_failed',
  errorCategory: 'NETWORK_CONFIG',
  message: 'subnet overlaps',
  occurredAt: '2026-01-15T10:00:00.000Z',
  source: 'provider',
  ...overrides,
});

const post = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/events', payload: payload as object });
const storedCount = () => prisma.operationalEvent.count({ where: { labId: lab.id } });

describe('POST /api/events', () => {
  it('returns 201 for a new event and 200 for its redelivery', async () => {
    const payload = event();

    const first = await post(payload);
    const second = await post(payload);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({
      eventId: first.json().data.eventId,
      duplicate: true,
    });
  });

  // Negative cases: refused, and nothing is stored.
  it.each([
    ['a failure without a category', { errorCategory: undefined }],
    ['an unknown field', { priority: 'p1' }],
    ['a free-text category', { errorCategory: 'subnet broke' }],
  ])('rejects %s with 400', async (_case, overrides) => {
    const before = await storedCount();

    const response = await post(event(overrides));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(await storedCount()).toBe(before);
  });

  it('rejects an unknown lab with 422', async () => {
    const response = await post(event({ labId: 'no-such-lab' }));

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNKNOWN_REFERENCE');
  });

  it('rejects a body over 16 KB with 413', async () => {
    const response = await post(event({ metadata: { blob: 'x'.repeat(17 * 1024) } }));

    expect(response.statusCode).toBe(413);
  });
});

describe('GET /api/labs/:id/events', () => {
  it('lists the lab events newest first', async () => {
    await post(event({ occurredAt: '2026-01-15T08:00:00.000Z' }));
    await post(event({ occurredAt: '2026-01-15T11:00:00.000Z' }));

    const response = await app.inject({ method: 'GET', url: `/api/labs/${lab.id}/events` });

    expect(response.statusCode).toBe(200);
    const times = response.json().data.map((e: { occurredAt: string }) => e.occurredAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('returns 404 for an unknown lab', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/labs/nope/events' });

    expect(response.statusCode).toBe(404);
  });
});
