import { afterAll, describe, expect, it } from 'vitest';
import { signedInCookie } from '../../../fixtures/session.fixture.js';
import { prisma } from '../../../../src/db.js';
import { approveAction, ApprovalExpiredError } from '../../../../src/modules/recovery/services/approve.js';
import { expireStaleApprovals } from '../../../../src/modules/recovery/services/expire.js';
import { failedIncident, removeFixtures } from '../../../fixtures/incident.fixture.js';

const { operatorId } = await signedInCookie();
const ACTOR = { type: 'human', id: operatorId } as const;

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

let day = 0;
async function pending(expiresInMs: number) {
  const fixture = await failedIncident(new Date(Date.UTC(2021, 9, (day += 1), 10, 1)), ACTOR);
  await prisma.recoveryAction.update({
    where: { id: fixture.recoveryActionId! },
    data: { expiresAt: new Date(Date.now() + expiresInMs) },
  });
  return { ...fixture, recoveryActionId: fixture.recoveryActionId! };
}

const statusOf = async (id: string) =>
  (await prisma.recoveryAction.findUniqueOrThrow({ where: { id } })).status;
const incidentStatus = async (id: string) =>
  (await prisma.incident.findUniqueOrThrow({ where: { id } })).status;

describe('expireStaleApprovals', () => {
  it('expires overdue approvals and leaves current ones alone', async () => {
    const overdue = await pending(-60_000);
    const current = await pending(60 * 60_000);

    await expireStaleApprovals();

    expect(await statusOf(overdue.recoveryActionId)).toBe('expired');
    expect(await incidentStatus(overdue.incidentId)).toBe('manual_review');
    expect(await statusOf(current.recoveryActionId)).toBe('awaiting_approval');
    const audit = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'recovery.expired', targetId: overdue.recoveryActionId },
    });
    expect(audit.actorId).toBe('approval-expiry-sweep');
  });

  // Negative: an expired approval can never run, even if approve arrives later.
  it('refuses an approval that arrives after the sweep', async () => {
    const { recoveryActionId } = await pending(-60_000);
    await expireStaleApprovals();

    await expect(approveAction(recoveryActionId, ACTOR)).rejects.toThrow();
    expect(await statusOf(recoveryActionId)).toBe('expired');
    expect(await prisma.jobExecution.count({ where: { jobKey: `execute-${recoveryActionId}` } })).toBe(0);
  });

  // Negative: several workers sweep at once; each row is expired exactly once.
  it('expires each row once when sweeps run concurrently', async () => {
    const { recoveryActionId } = await pending(-60_000);

    await Promise.all([expireStaleApprovals(), expireStaleApprovals(), expireStaleApprovals()]);

    expect(
      await prisma.auditEntry.count({ where: { action: 'recovery.expired', targetId: recoveryActionId } }),
    ).toBe(1);
  });

  // A row being decided right now is skipped, not waited on.
  it('skips a row another transaction holds', async () => {
    const { recoveryActionId } = await pending(-60_000);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RecoveryAction" WHERE id = ${recoveryActionId} FOR UPDATE`;
      await expireStaleApprovals();
    });

    expect(await statusOf(recoveryActionId)).toBe('awaiting_approval');
    // The approve that held it decides with its own expiry check.
    await expect(approveAction(recoveryActionId, ACTOR)).rejects.toBeInstanceOf(ApprovalExpiredError);
  });
});
