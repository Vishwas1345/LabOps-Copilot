import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/app.js';
import { signedInCookie } from '../../../fixtures/session.fixture.js';
import { loadConfig } from '../../../../src/platform/config/env.js';
import { prisma } from '../../../../src/db.js';
import { recordJob } from '../../../../src/platform/jobs/record.js';
import { writeAudit } from '../../../../src/platform/audit/audit.js';

const app = await buildApp({ config: { ...loadConfig(), DEMO_ENABLED: false } });
const { cookie } = await signedInCookie();
const labs: string[] = [];

afterAll(async () => {
  await prisma.lab.deleteMany({ where: { id: { in: labs } } });
  await app.close();
  await prisma.$disconnect();
});

const get = async (url: string) => {
  const response = await app.inject({ method: 'GET', url, headers: { cookie } });
  return { status: response.statusCode, body: response.json() };
};

// Other test files share the database, so these assert on deltas.
describe('GET /api/labs/summary', () => {
  it('counts every status, zero included', async () => {
    const before = (await get('/api/labs/summary')).body.data;
    for (const status of ['failed', 'failed', 'ready'] as const) {
      labs.push((await prisma.lab.create({ data: { name: 'overview-test', status } })).id);
    }

    const after = (await get('/api/labs/summary')).body.data;

    expect(Object.keys(after).sort()).toEqual(
      ['failed', 'provisioning', 'ready', 'recovering', 'stopped'].sort(),
    );
    expect(after.failed - before.failed).toBe(2);
    expect(after.ready - before.ready).toBe(1);
  });
});

describe('GET /api/jobs/summary', () => {
  it('counts job rows by queue and status', async () => {
    const countOf = (rows: Array<{ queue: string; status: string; count: number }>) =>
      rows.find((row) => row.queue === 'investigate' && row.status === 'queued')?.count ?? 0;
    const before = countOf((await get('/api/jobs/summary')).body.data);

    await prisma.$transaction((tx) =>
      recordJob(tx, 'investigate', `overview-${randomUUID()}`, {}, undefined),
    );

    expect(countOf((await get('/api/jobs/summary')).body.data)).toBe(before + 1);
  });
});

describe('GET /api/audit', () => {
  it('pages newest first without skipping or repeating', async () => {
    const marker = `overview-${randomUUID()}`;
    for (let i = 0; i < 3; i += 1) {
      await prisma.$transaction((tx) =>
        writeAudit(tx, {
          actor: { type: 'system', id: 'overview-test' },
          action: 'test.entry',
          targetType: 'test',
          targetId: marker,
          outcome: String(i),
        }),
      );
    }

    const first = await get('/api/audit?limit=2');
    const second = await get(`/api/audit?limit=2&cursor=${first.body.nextCursor}`);

    const seqs = [...first.body.data, ...second.body.data].map((e: { seq: string }) => BigInt(e.seq));
    expect([...seqs].sort((a, b) => (a > b ? -1 : 1))).toEqual(seqs);
    expect(new Set(seqs).size).toBe(4);
    expect(first.body.data[0]).toMatchObject({ targetId: marker, outcome: '2', action: 'test.entry' });
  });

  // Negative: a cursor that is not a seq never reaches BigInt().
  it.each(['abc', '-1', '1e9', '99999999999999999999'])('rejects cursor %p', async (cursor) => {
    expect((await get(`/api/audit?cursor=${cursor}`)).status).toBe(400);
  });
});
