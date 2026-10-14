import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { signedInCookie } from '../auth/session.fixture.js';
import { loadConfig } from '../config/env.js';
import { prisma } from '../db.js';
import { executeJobKey } from './approve.js';
import { failedIncident, removeFixtures, untilBlocked } from './incident.fixture.js';

const app = await buildApp({ config: { ...loadConfig(), DEMO_ENABLED: false } });
const { cookie, operatorId } = await signedInCookie();
const ACTOR = { type: 'human', id: operatorId } as const;

afterAll(async () => {
  await removeFixtures();
  await app.close();
  await prisma.$disconnect();
});

let day = 0;
const nextDay = () => new Date(Date.UTC(2021, 5, (day += 1), 10, 1));
const pending = () => failedIncident(nextDay(), ACTOR);

const decide = (id: string, decision: 'approve' | 'reject') =>
  app.inject({ method: 'POST', url: `/api/recovery-actions/${id}/${decision}`, headers: { cookie } });

const actionOf = (id: string) => prisma.recoveryAction.findUniqueOrThrow({ where: { id } });
const statusOf = async (incidentId: string) =>
  (await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })).status;

describe('POST /api/recovery-actions/:id/approve', () => {
  it('records the approver from the session and queues one execute job', async () => {
    const { recoveryActionId, incidentId } = await pending();

    const first = await decide(recoveryActionId!, 'approve');
    const repeat = await decide(recoveryActionId!, 'approve');

    expect(first.statusCode).toBe(202);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().data.jobId).toBe(first.json().data.jobId);
    expect(await actionOf(recoveryActionId!)).toMatchObject({
      status: 'approved',
      approvedBy: operatorId,
    });
    // Still waiting for the execute job, which is what moves it on.
    expect(await statusOf(incidentId)).toBe('awaiting_approval');
    const job = await prisma.jobExecution.findUniqueOrThrow({
      where: { jobKey: executeJobKey(recoveryActionId!) },
    });
    expect(job).toMatchObject({ id: first.json().data.jobId, queue: 'execute' });
    const audit = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'recovery.approved', targetId: recoveryActionId! },
    });
    expect(audit.actorId).toBe(operatorId);
  });

  // Negative: two operators approving at once must queue exactly one job.
  // The test holds the action row so both requests are mid-transaction.
  it('queues one job when two approvals race', async () => {
    const { recoveryActionId } = await pending();

    let racing: ReturnType<typeof decide>[] = [];
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RecoveryAction" WHERE id = ${recoveryActionId} FOR UPDATE`;
      racing = [decide(recoveryActionId!, 'approve'), decide(recoveryActionId!, 'approve')];
      await untilBlocked(2);
    });
    const responses = await Promise.all(racing);

    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 202]);
    expect(new Set(responses.map((r) => r.json().data.jobId)).size).toBe(1);
    expect(
      await prisma.auditEntry.count({ where: { action: 'recovery.approved', targetId: recoveryActionId! } }),
    ).toBe(1);
  });

  // Negative: a click after the window has passed loses, even before the sweep.
  it('expires a late approval and sends the incident to manual review', async () => {
    const { recoveryActionId, incidentId } = await pending();
    await prisma.recoveryAction.update({
      where: { id: recoveryActionId! },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await decide(recoveryActionId!, 'approve');

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('APPROVAL_EXPIRED');
    expect(await actionOf(recoveryActionId!)).toMatchObject({ status: 'expired', approvedBy: null });
    expect(await statusOf(incidentId)).toBe('manual_review');
    expect(await prisma.jobExecution.count({ where: { jobKey: executeJobKey(recoveryActionId!) } })).toBe(0);
  });

  it('refuses an action that policy blocked, and an unknown one', async () => {
    const { incidentId, labIds } = await failedIncident(nextDay(), ACTOR, {
      category: 'PERMISSION_DENIED',
    });
    const blocked = await prisma.recoveryAction.findFirstOrThrow({ where: { incidentId } });

    expect(blocked.status).toBe('rejected_by_policy');
    expect(labIds).toHaveLength(2);
    expect((await decide(blocked.id, 'approve')).json().error.code).toBe(
      'RECOVERY_ACTION_NOT_PENDING',
    );
    expect((await decide('does-not-exist', 'approve')).statusCode).toBe(404);
  });
});

describe('POST /api/recovery-actions/:id/reject', () => {
  it('rejects, reopens the incident, and cannot then be approved', async () => {
    const { recoveryActionId, incidentId } = await pending();

    const response = await decide(recoveryActionId!, 'reject');

    expect(response.statusCode).toBe(200);
    expect(await actionOf(recoveryActionId!)).toMatchObject({ status: 'rejected' });
    expect(await statusOf(incidentId)).toBe('open');
    expect((await decide(recoveryActionId!, 'approve')).statusCode).toBe(409);
    expect((await decide(recoveryActionId!, 'reject')).statusCode).toBe(409);
  });
});
