import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Actor } from '../audit/audit.js';
import { prisma } from '../db.js';
import { ingestEvent, UnknownReferenceError } from './service.js';

const ACTOR: Actor = { type: 'system', id: 'events-test' };
const labs: string[] = [];

afterEach(async () => {
  await prisma.lab.deleteMany({ where: { id: { in: labs.splice(0) } } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function provisioningLab() {
  const lab = await prisma.lab.create({ data: { name: 'events-test' } });
  labs.push(lab.id);
  return lab.id;
}

const failure = (labId: string, overrides: Record<string, unknown> = {}) => ({
  providerEventId: randomUUID(),
  labId,
  type: 'provision_failed',
  errorCategory: 'PROVISION_TIMEOUT',
  message: 'timed out',
  occurredAt: '2026-01-15T09:00:00.000Z',
  source: 'provider',
  ...overrides,
});

const statusOf = async (id: string) =>
  (await prisma.lab.findUniqueOrThrow({ where: { id } })).status;
const transitionsOf = (labId: string) =>
  prisma.auditEntry.count({ where: { action: 'lab.transition', targetId: labId } });

describe('ingestEvent', () => {
  it('stores a failure and moves the lab to failed', async () => {
    const labId = await provisioningLab();

    const result = await ingestEvent(failure(labId), ACTOR);

    expect(result.duplicate).toBe(false);
    expect(result.transition).toEqual({ from: 'provisioning', to: 'failed' });
    expect(await statusOf(labId)).toBe('failed');
    const audit = await prisma.auditEntry.findFirst({
      where: { action: 'event.received', targetId: result.eventId },
    });
    expect(audit?.outcome).toBe('stored');
  });

  // Negative: a redelivery is stored once and moves the lab once.
  it('treats a redelivery as a duplicate with no second transition', async () => {
    const labId = await provisioningLab();
    const event = failure(labId);

    const first = await ingestEvent(event, ACTOR);
    const second = await ingestEvent(event, ACTOR);

    expect(second).toEqual({ eventId: first.eventId, duplicate: true, transition: null });
    expect(await prisma.operationalEvent.count({ where: { labId } })).toBe(1);
    expect(await transitionsOf(labId)).toBe(1);
  });

  // Negative: two copies racing past the lookup; the unique key decides.
  it('stores exactly one of two concurrent copies', async () => {
    const labId = await provisioningLab();
    const event = failure(labId);

    const results = await Promise.all([ingestEvent(event, ACTOR), ingestEvent(event, ACTOR)]);

    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.eventId)).size).toBe(1);
    expect(await prisma.operationalEvent.count({ where: { labId } })).toBe(1);
    expect(await transitionsOf(labId)).toBe(1);
  });

  // A late failure for an already-failed lab is evidence, not a transition.
  it('stores an event the state machine does not allow, without moving the lab', async () => {
    const labId = await provisioningLab();
    await ingestEvent(failure(labId), ACTOR);

    const late = await ingestEvent(failure(labId), ACTOR);

    expect(late.duplicate).toBe(false);
    expect(late.transition).toBeNull();
    expect(await statusOf(labId)).toBe('failed');
    expect(await prisma.operationalEvent.count({ where: { labId } })).toBe(2);
    expect(await transitionsOf(labId)).toBe(1);
  });

  // Negative: secrets never reach the stored row.
  it('redacts secrets before storing', async () => {
    const labId = await provisioningLab();

    const { eventId } = await ingestEvent(
      failure(labId, {
        message: 'deploy failed: password=hunter2',
        metadata: { region: 'eu', clientSecret: 'sk-live-stored?' },
      }),
      ACTOR,
    );

    const row = await prisma.operationalEvent.findUniqueOrThrow({ where: { id: eventId } });
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('hunter2');
    expect(stored).not.toContain('sk-live-stored?');
    expect(row.metadata).toMatchObject({ region: 'eu' });
  });

  it.each([
    ['labId', { labId: 'no-such-lab' }],
    ['dependencyId', { dependencyId: 'no-such-dependency' }],
  ])('rejects an unknown %s and stores nothing', async (field, overrides) => {
    const labId = await provisioningLab();
    const event = failure(labId, overrides);

    await expect(ingestEvent(event, ACTOR)).rejects.toThrow(UnknownReferenceError);
    await expect(ingestEvent(event, ACTOR)).rejects.toMatchObject({ field });
    expect(await prisma.operationalEvent.count({ where: { labId } })).toBe(0);
  });

  // Negative: the CHECK holds even for a write that skips validation.
  it('rejects a failure without a category at the database', async () => {
    const labId = await provisioningLab();

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "OperationalEvent" (id, "labId", type, message, source, "occurredAt", "deduplicationKey")
         VALUES ('${randomUUID()}', '${labId}', 'provision_failed', 'x', 'provider', now(), '${randomUUID()}')`,
      ),
    ).rejects.toThrow(/OperationalEvent_category_matches_type/);
  });
});
