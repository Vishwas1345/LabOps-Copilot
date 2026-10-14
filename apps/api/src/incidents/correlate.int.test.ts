import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Actor } from '../audit/audit.js';
import { prisma } from '../db.js';
import { correlationWindow } from '../events/correlation-window.js';
import { ingestEvent } from '../events/service.js';
import { createSimulatedLabs } from '../labs/service.js';
import { createTrainingEvent } from '../labs/simulator.js';
import { createLogger } from '../observability/logger.js';
import { correlateWindow, handleCorrelate } from './correlate.job.js';

const ACTOR: Actor = { type: 'system', id: 'correlate-test' };
const log = createLogger(undefined, 'silent');
const labs: string[] = [];
const dependencies: string[] = [];

// Incidents first: an incident's anchor event must not vanish under it.
afterEach(async () => {
  const ours = labs.splice(0);
  await prisma.incident.deleteMany({ where: { labs: { some: { labId: { in: ours } } } } });
  await prisma.lab.deleteMany({ where: { id: { in: ours } } });
  await prisma.dependency.deleteMany({ where: { id: { in: dependencies.splice(0) } } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function dependency(kind = 'image-registry') {
  const dep = await prisma.dependency.create({ data: { kind } });
  dependencies.push(dep.id);
  return dep.id;
}

async function failedLab(
  at: string,
  failure: { errorCategory: string; dependencyId?: string; message?: string },
) {
  const lab = await prisma.lab.create({ data: { name: 'correlate-test', labType: 'azure-vm' } });
  labs.push(lab.id);
  const { eventId } = await ingestEvent(
    {
      providerEventId: randomUUID(),
      labId: lab.id,
      type: 'provision_failed',
      message: 'provisioning failed',
      occurredAt: at,
      source: 'provider',
      ...failure,
    },
    ACTOR,
  );
  return { labId: lab.id, eventId };
}

const incidentsOf = (labIds: string[]) =>
  prisma.incident.findMany({
    where: { labs: { some: { labId: { in: labIds } } } },
    include: { labs: true },
    orderBy: { createdAt: 'asc' },
  });

const windowOf = (at: string) => correlationWindow(new Date(at)).start;

/** Waits until `count` sessions in this database wait on a lock. */
async function untilBlocked(count: number) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [{ waiting }] = await prisma.$queryRaw<[{ waiting: number }]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (waiting >= count || Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('correlateWindow', () => {
  // The project's most important negative test (correlation-engine skill).
  it('does not merge identical raw messages with different categories', async () => {
    const dep = await dependency();
    const message = 'operation failed: see provider logs';
    const a = await failedLab('2024-02-01T10:01:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep, message,
    });
    const b = await failedLab('2024-02-01T10:02:00.000Z', {
      errorCategory: 'PERMISSION_DENIED', dependencyId: dep, message,
    });

    await correlateWindow(windowOf('2024-02-01T10:01:00.000Z'), log);

    const incidents = await incidentsOf([a.labId, b.labId]);
    expect(incidents).toHaveLength(2);
    expect(incidents.every((incident) => incident.labs.length === 1)).toBe(true);
    // The near miss says why they stayed apart.
    const reason = incidents[1].correlationReason as { nearMiss: { reasons: string[] } };
    expect(reason.nearMiss.reasons).toContain(
      'different category (PERMISSION_DENIED vs PROVISION_TIMEOUT)',
    );
  });

  it('merges different messages with the same category, with readable reasons', async () => {
    const dep = await dependency();
    const a = await failedLab('2024-02-02T10:01:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep, message: 'timed out pulling image',
    });
    const b = await failedLab('2024-02-02T10:03:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep, message: 'deadline exceeded',
    });

    const outcome = await correlateWindow(windowOf('2024-02-02T10:01:00.000Z'), log);

    expect(outcome).toMatchObject({ incidentsCreated: 1, labsJoined: 0 });
    const [incident] = await incidentsOf([a.labId, b.labId]);
    expect(incident.title).toBe('PROVISION_TIMEOUT on image-registry');
    expect(incident.windowKey).toBe(`anchor:${a.eventId}`);
    expect(incident.confidenceScore).toBe(0.85);
    const member = incident.labs.find((lab) => lab.labId === b.labId);
    expect(member?.reason).toBe(
      'same category PROVISION_TIMEOUT; same dependency image-registry; 2 min from anchor; ' +
        'same lab type azure-vm',
    );
    expect(member?.signalScore).toBe(0.85);
    const audit = await prisma.auditEntry.findFirst({
      where: { action: 'incident.created', targetId: incident.id },
    });
    expect(audit?.outcome).toBe('open');
  });

  // Negative: a re-run, or a retry after a crash, must not duplicate anything.
  it('is a no-op when run again over the same window', async () => {
    const dep = await dependency();
    const at = '2024-02-03T10:01:00.000Z';
    const a = await failedLab(at, { errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep });
    const b = await failedLab(at, { errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep });

    await correlateWindow(windowOf(at), log);
    const second = await correlateWindow(windowOf(at), log);

    expect(second).toEqual({ considered: 0, incidentsCreated: 0, labsJoined: 0 });
    const incidents = await incidentsOf([a.labId, b.labId]);
    expect(incidents).toHaveLength(1);
    expect(
      await prisma.auditEntry.count({
        where: { action: 'incident.created', targetId: incidents[0].id },
      }),
    ).toBe(1);
  });

  // Negative: overlapping windows see different failures, so they pick
  // different anchors and the windowKey index cannot stop both claiming b.
  // A row lock on the labs holds both runs mid-transaction, forcing the race.
  it('never puts a lab in two incidents when overlapping windows race', async () => {
    const dep = await dependency();
    const a = await failedLab('2024-02-04T09:58:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep,
    });
    const b = await failedLab('2024-02-04T10:03:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep,
    });

    let runs: Promise<unknown>[] = [];
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lab" WHERE id IN (${a.labId}, ${b.labId}) FOR UPDATE`;
      runs = [
        correlateWindow(windowOf('2024-02-04T09:58:00.000Z'), log),
        correlateWindow(windowOf('2024-02-04T10:15:00.000Z'), log),
      ];
      await untilBlocked(2);
    });
    await Promise.all(runs);

    const holding = await prisma.incidentLab.count({ where: { labId: b.labId } });
    expect(holding).toBe(1);
  });

  it('adds a later failure to an open incident and recomputes its strength', async () => {
    const dep = await dependency();
    const a = await failedLab('2024-02-05T10:08:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep,
    });
    const b = await failedLab('2024-02-05T10:09:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep,
    });
    await correlateWindow(windowOf('2024-02-05T10:08:00.000Z'), log);
    // 12 min after the anchor, time scores half: 0.75, the incident's new weakest link.
    const late = await failedLab('2024-02-05T10:20:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep,
    });

    const outcome = await correlateWindow(windowOf('2024-02-05T10:20:00.000Z'), log);

    expect(outcome).toMatchObject({ incidentsCreated: 0, labsJoined: 1 });
    const [incident] = await incidentsOf([a.labId, b.labId, late.labId]);
    expect(incident.labs).toHaveLength(3);
    expect(incident.confidenceScore).toBe(0.75);
    expect(
      await prisma.auditEntry.count({
        where: { action: 'incident.lab_added', targetId: incident.id },
      }),
    ).toBe(1);
  });

  // Negative: once investigation starts, the incident's scope is frozen.
  it('does not add labs to an incident past open', async () => {
    const dep = await dependency();
    const a = await failedLab('2024-02-06T10:08:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep,
    });
    await correlateWindow(windowOf('2024-02-06T10:08:00.000Z'), log);
    await prisma.incident.updateMany({
      where: { anchorEventId: a.eventId },
      data: { status: 'investigating' },
    });
    const late = await failedLab('2024-02-06T10:10:00.000Z', {
      errorCategory: 'PROVISION_TIMEOUT', dependencyId: dep,
    });

    await correlateWindow(windowOf('2024-02-06T10:10:00.000Z'), log);

    const incidents = await incidentsOf([a.labId, late.labId]);
    expect(incidents).toHaveLength(2);
    expect(incidents.map((incident) => incident.labs.length)).toEqual([1, 1]);
  });

  // Negative: a malformed payload is rejected before anything is read.
  it('rejects a payload with unknown fields', async () => {
    await expect(
      handleCorrelate({ windowStart: '2024-02-07T10:00:00.000Z', labIds: ['x'] }, log),
    ).rejects.toThrow();
  });

  it('turns the training scenario into one 12-lab incident and 7 single ones', async () => {
    // Its own seed and epoch, so no other data shares these windows.
    const scenario = createTrainingEvent(9_001, new Date('2024-03-01T09:00:00.000Z'));
    labs.push(...scenario.labs.map((lab) => lab.id));
    dependencies.push(...scenario.dependencies.map((dep) => dep.id));
    await prisma.$transaction((tx) => createSimulatedLabs(tx, scenario));
    for (const event of scenario.events) await ingestEvent(event, ACTOR);

    const windows = new Set(
      scenario.events
        .filter((event) => event.type === 'provision_failed')
        .map((event) => windowOf(event.occurredAt).toISOString()),
    );
    for (const windowStart of windows) await handleCorrelate({ windowStart }, log);

    const incidents = await incidentsOf(scenario.labs.map((lab) => lab.id));
    const sizes = incidents.map((incident) => incident.labs.length).sort((x, y) => y - x);
    expect(sizes).toEqual([12, 1, 1, 1, 1, 1, 1, 1]);
    const burst = incidents.find((incident) => incident.labs.length === 12);
    expect(burst).toMatchObject({
      title: 'PROVISION_TIMEOUT on image-registry',
      severity: 'high',
      status: 'open',
    });
    // Every inclusion is explainable from the stored row.
    expect(burst?.labs.every((lab) => lab.reason.length > 0)).toBe(true);
    expect(
      incidents.filter((incident) => incident.labs.length === 1).every(
        (incident) => incident.severity === 'low' && incident.confidenceScore === null,
      ),
    ).toBe(true);
  }, 30_000);
});
