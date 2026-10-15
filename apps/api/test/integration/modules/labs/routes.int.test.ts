import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../../src/platform/config/env.js';
import { signedInCookie } from '../../../fixtures/session.fixture.js';
import { buildApp } from '../../../../src/app.js';
import { prisma } from '../../../../src/db.js';

const app = await buildApp({
  config: { ...loadConfig(), DEMO_ENABLED: false },
});
const headers = { cookie: (await signedInCookie()).cookie };
const created: string[] = [];

afterAll(async () => {
  await prisma.lab.deleteMany({ where: { id: { in: created } } });
  await prisma.dependency.deleteMany({ where: { kind: 'routes-test' } });
  await app.close();
  await prisma.$disconnect();
});

async function createLabs(count: number, status: 'ready' | 'failed' = 'ready') {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const lab = await prisma.lab.create({
      data: { name: `routes-test-${i}`, status },
    });
    ids.push(lab.id);
  }
  created.push(...ids);
  return ids;
}

async function getJson(url: string) {
  const response = await app.inject({ method: 'GET', url, headers });
  return { status: response.statusCode, body: response.json() };
}

describe('GET /api/labs', () => {
  // Pages through the whole table, so it holds even when other rows exist.
  it('pages through every lab exactly once', async () => {
    const ids = await createLabs(5);
    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const url: string = `/api/labs?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const { status, body } = await getJson(url);
      expect(status).toBe(200);
      expect(body.data.length).toBeLessThanOrEqual(2);
      seen.push(...body.data.map((lab: { id: string }) => lab.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length);
    for (const id of ids) {
      expect(seen).toContain(id);
    }
  });

  it('filters by status', async () => {
    const [failedId] = await createLabs(1, 'failed');

    const { body } = await getJson('/api/labs?status=failed&limit=100');

    expect(body.data.every((lab: { status: string }) => lab.status === 'failed')).toBe(true);
    expect(body.data.map((lab: { id: string }) => lab.id)).toContain(failedId);
  });

  // Negative cases: bad queries are refused with the envelope.
  it.each([
    '/api/labs?limit=101',
    '/api/labs?limit=0',
    '/api/labs?status=exploded',
    '/api/labs?stauts=failed',
  ])('rejects %s with 400', async (url) => {
    const { status, body } = await getJson(url);

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/labs/:id', () => {
  it('returns the lab view with its dependencies', async () => {
    const [labId] = await createLabs(1);
    const dependency = await prisma.dependency.create({
      data: { kind: 'routes-test' },
    });
    await prisma.labDependency.create({
      data: { labId, dependencyId: dependency.id },
    });

    const { status, body } = await getJson(`/api/labs/${labId}`);

    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      id: labId,
      status: 'ready',
      source: 'simulated',
      dependencyIds: [dependency.id],
    });
  });

  it('returns 404 in the envelope for an unknown lab', async () => {
    const { status, body } = await getJson('/api/labs/does-not-exist');

    expect(status).toBe(404);
    expect(body.error.code).toBe('LAB_NOT_FOUND');
  });
});
