import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import { signedInCookie } from '../auth/session.fixture.js';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';
import { correlationWindow } from '../events/correlation-window.js';
import { ingestEvent } from '../events/service.js';
import { createLogger } from '../observability/logger.js';
import { correlateWindow } from './correlate.job.js';

const app = await buildApp({
  config: { ...loadConfig(), DEMO_ENABLED: false },
});
const headers = { cookie: (await signedInCookie()).cookie };
const ACTOR = { type: 'system', id: 'incident-routes-test' } as const;
const labs: string[] = [];
const dependency = await prisma.dependency.create({ data: { kind: 'image-registry' } });

afterAll(async () => {
  await prisma.incident.deleteMany({ where: { labs: { some: { labId: { in: labs } } } } });
  await prisma.lab.deleteMany({ where: { id: { in: labs } } });
  await prisma.dependency.delete({ where: { id: dependency.id } });
  await app.close();
  await prisma.$disconnect();
});

async function getJson(url: string) {
  const response = await app.inject({ method: 'GET', url, headers });
  return { status: response.statusCode, body: response.json() };
}

// Two related failures and one unrelated: one 2-lab incident, one single.
async function seedIncidents(): Promise<{ pairId: string; singleId: string }> {
  const fail = async (at: string, errorCategory: string, dependencyId?: string) => {
    const lab = await prisma.lab.create({ data: { name: 'incident-routes-test' } });
    labs.push(lab.id);
    await ingestEvent(
      {
        providerEventId: randomUUID(),
        labId: lab.id,
        type: 'provision_failed',
        errorCategory,
        dependencyId,
        message: 'provisioning failed',
        occurredAt: at,
        source: 'provider',
      },
      ACTOR,
    );
    return lab.id;
  };
  const anchorLab = await fail('2024-04-01T10:01:00.000Z', 'PROVISION_TIMEOUT', dependency.id);
  await fail('2024-04-01T10:02:00.000Z', 'PROVISION_TIMEOUT', dependency.id);
  const loneLab = await fail('2024-04-01T10:03:00.000Z', 'PERMISSION_DENIED');
  await correlateWindow(
    correlationWindow(new Date('2024-04-01T10:01:00.000Z')).start,
    createLogger(undefined, 'silent'),
  );

  const idOf = async (labId: string) =>
    (await prisma.incidentLab.findFirstOrThrow({ where: { labId } })).incidentId;
  return { pairId: await idOf(anchorLab), singleId: await idOf(loneLab) };
}

const { pairId, singleId } = await seedIncidents();

describe('GET /api/incidents', () => {
  // Pages through everything, so it holds even when other incidents exist.
  it('pages through every incident exactly once', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const { body } = await getJson(`/api/incidents?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...body.data.map((incident: { id: string }) => incident.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(expect.arrayContaining([pairId, singleId]));
  });

  it('filters by severity and labels the score as correlation strength', async () => {
    const { status, body } = await getJson('/api/incidents?severity=low&limit=100');

    expect(status).toBe(200);
    const pair = body.data.find((incident: { id: string }) => incident.id === pairId);
    expect(pair).toMatchObject({ labCount: 2, severity: 'low', status: 'open' });
    expect(pair.correlationStrength).toBeGreaterThanOrEqual(0.7);
    expect(pair).not.toHaveProperty('confidenceScore');
  });

  // Negative: a misspelt filter fails instead of returning everything.
  it('rejects an unknown query parameter or value', async () => {
    expect((await getJson('/api/incidents?stauts=open')).status).toBe(400);
    expect((await getJson('/api/incidents?severity=critical')).status).toBe(400);
  });
});

describe('GET /api/incidents/:id', () => {
  it('explains every lab and returns its evidence', async () => {
    const { status, body } = await getJson(`/api/incidents/${pairId}`);

    expect(status).toBe(200);
    expect(body.data.labs).toHaveLength(2);
    const [anchor, member] = body.data.labs;
    expect(anchor).toMatchObject({ signalScore: null, eventId: body.data.anchorEventId });
    expect(member.reason).toContain('same category PROVISION_TIMEOUT');
    expect(member.signals).toHaveProperty('sharedDependency', 0.3);
    expect(body.data.events.map((event: { id: string }) => event.id).sort()).toEqual(
      body.data.labs.map((lab: { eventId: string }) => lab.eventId).sort(),
    );
    expect(body.data.correlationReason).toMatchObject({ threshold: 0.7 });
  });

  it('records why a single-lab incident stayed apart', async () => {
    const { body } = await getJson(`/api/incidents/${singleId}`);

    expect(body.data.correlationStrength).toBeNull();
    expect(body.data.correlationReason.summary).toMatch(/no other failure scored/);
  });

  // Negative: an unknown id is a 404 in the standard envelope.
  it('returns 404 for an unknown incident', async () => {
    const { status, body } = await getJson('/api/incidents/does-not-exist');

    expect(status).toBe(404);
    expect(body.error.code).toBe('INCIDENT_NOT_FOUND');
  });
});

describe('GET /api/incidents/:id/audit', () => {
  it('returns the incident history in commit order', async () => {
    const { status, body } = await getJson(`/api/incidents/${pairId}/audit`);

    expect(status).toBe(200);
    expect(body.data[0]).toMatchObject({ action: 'incident.created', actorType: 'worker' });
    const seqs = body.data.map((entry: { seq: string }) => BigInt(entry.seq));
    expect([...seqs].sort((x, y) => (x < y ? -1 : 1))).toEqual(seqs);
  });

  // Negative: a missing incident is 404, not an empty history.
  it('returns 404 for an unknown incident', async () => {
    expect((await getJson('/api/incidents/does-not-exist/audit')).status).toBe(404);
  });
});
