import { afterAll, describe, expect, it } from 'vitest';
import { signedInCookie } from '../auth/session.fixture.js';
import { prisma } from '../db.js';
import { createLogger } from '../observability/logger.js';
import { approveAction } from './approve.js';
import { applyAndVerify, createExecuteJob } from './execute.job.js';
import type { FixtureIncident } from './incident.fixture.js';
import { failedIncident, removeFixtures } from './incident.fixture.js';

const log = createLogger(undefined, 'silent');
const { operatorId } = await signedInCookie();
const ACTOR = { type: 'human', id: operatorId } as const;
const job = createExecuteJob();

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

let day = 0;
async function approved(
  options: Parameters<typeof failedIncident>[2] = {},
): Promise<FixtureIncident & { recoveryActionId: string }> {
  const fixture = await failedIncident(new Date(Date.UTC(2021, 7, (day += 1), 10, 1)), ACTOR, options);
  await approveAction(fixture.recoveryActionId!, ACTOR);
  return { ...fixture, recoveryActionId: fixture.recoveryActionId! };
}

const execute = (recoveryActionId: string) => job.handle({ recoveryActionId }, log);
const actionOf = (id: string) => prisma.recoveryAction.findUniqueOrThrow({ where: { id } });
const incidentOf = (id: string) => prisma.incident.findUniqueOrThrow({ where: { id } });
const labStatuses = async (ids: string[]) =>
  (await prisma.lab.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })).map((l) => l.status);

describe('execute job', () => {
  it('retries, verifies every lab is ready, and only then resolves', async () => {
    const { recoveryActionId, incidentId, labIds } = await approved();

    expect(await execute(recoveryActionId)).toEqual({ outcome: 'succeeded' });

    expect(await labStatuses(labIds)).toEqual(['ready', 'ready']);
    const action = await actionOf(recoveryActionId);
    expect(action).toMatchObject({ status: 'succeeded', verificationResult: { passed: true, notReady: [] } });
    expect(action.executedAt).not.toBeNull();
    // Before and after are both stored (CLAUDE.md 6).
    expect(Object.values((action.result as { before: object }).before)).toEqual(['failed', 'failed']);
    const incident = await incidentOf(incidentId);
    expect(incident.status).toBe('resolved');
    expect(incident.resolvedAt).not.toBeNull();
  });

  // Negative: the action ran, but the labs are not fixed. Finishing is not
  // verification, so the incident must not resolve.
  it('sends the incident to manual review when the retry does not fix it', async () => {
    const { recoveryActionId, incidentId, labIds } = await approved({ category: 'NETWORK_CONFIG' });

    expect(await execute(recoveryActionId)).toEqual({ outcome: 'failed' });

    expect(await labStatuses(labIds)).toEqual(['failed', 'failed']);
    expect(await actionOf(recoveryActionId)).toMatchObject({
      status: 'failed',
      verificationResult: { passed: false },
    });
    expect((await incidentOf(incidentId)).status).toBe('manual_review');
  });

  // Negative (D1): fixing only the targeted lab leaves the incident unresolved.
  it('does not resolve an incident while any of its labs is still failed', async () => {
    const { recoveryActionId, incidentId, labIds } = await approved({ targets: 'first' });

    await execute(recoveryActionId);

    const statuses = await prisma.lab.findMany({ where: { id: { in: labIds } } });
    expect(statuses.find((l) => l.id === labIds[0])?.status).toBe('ready');
    expect(statuses.find((l) => l.id === labIds[1])?.status).toBe('failed');
    expect((await incidentOf(incidentId)).status).toBe('manual_review');
  });

  it('never resolves through a read-only recheck', async () => {
    const { recoveryActionId, incidentId, labIds } = await approved({
      action: 'RECHECK_DEPENDENCY',
      targets: 'dependency',
    });

    expect(await execute(recoveryActionId)).toEqual({ outcome: 'failed' });
    expect(await labStatuses(labIds)).toEqual(['failed', 'failed']);
    expect((await incidentOf(incidentId)).status).toBe('manual_review');
  });

  // Negative: a replayed job returns the prior result with no second effect.
  it('changes nothing when the same job runs again', async () => {
    const { recoveryActionId, labIds } = await approved();
    await execute(recoveryActionId);
    const transitions = () =>
      prisma.auditEntry.count({ where: { action: 'lab.transition', targetId: { in: labIds } } });
    const before = await transitions();

    expect(await execute(recoveryActionId)).toEqual({ outcome: 'skipped' });
    expect(await transitions()).toBe(before);
  });

  // Negative (TOCTOU): approval is permission to re-check, not to execute.
  it.each<[string, (fixture: FixtureIncident & { recoveryActionId: string }) => Promise<unknown>, string]>([
    [
      'a lab that changed after approval',
      ({ labIds }) => prisma.lab.update({ where: { id: labIds[0] }, data: { status: 'ready' } }),
      'state',
    ],
    [
      'an approval that expired before execution',
      ({ recoveryActionId }) =>
        prisma.recoveryAction.update({
          where: { id: recoveryActionId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      'authorisation',
    ],
    [
      'a target taken by another action after approval',
      ({ incidentId, labIds }) =>
        prisma.recoveryAction.create({
          data: {
            incidentId,
            actionType: 'RERUN_VALIDATION',
            targetIds: [labIds[1]],
            parameters: {},
            status: 'running',
            idempotencyKey: `seed-${incidentId}`,
            proposedBy: operatorId,
            policyDecisions: [],
          },
        }),
      'concurrency',
    ],
  ])('blocks %s', async (_label, change, step) => {
    const fixture = await approved();
    await change(fixture);

    expect(await execute(fixture.recoveryActionId)).toEqual({ outcome: 'blocked' });

    expect(await actionOf(fixture.recoveryActionId)).toMatchObject({
      status: 'blocked',
      blockedAt: step,
      executedAt: null,
    });
    expect((await incidentOf(fixture.incidentId)).status).toBe('manual_review');
    const audit = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'recovery.blocked', targetId: fixture.recoveryActionId },
    });
    expect(audit.metadata).toMatchObject({ blockedAt: step });
  });

  it('resumes an action that crashed after starting', async () => {
    const { recoveryActionId, incidentId, labIds } = await approved();
    // The state the first transaction leaves before a crash.
    await prisma.recoveryAction.update({
      where: { id: recoveryActionId },
      data: { status: 'running', executedAt: new Date() },
    });
    await prisma.lab.updateMany({ where: { id: { in: labIds } }, data: { status: 'recovering' } });
    await prisma.incident.update({ where: { id: incidentId }, data: { status: 'recovering' } });

    expect(await execute(recoveryActionId)).toEqual({ outcome: 'succeeded' });
    expect((await incidentOf(incidentId)).status).toBe('resolved');
  });

  // Negative: exhaustion settled the action while the simulated step ran; the
  // late result must not touch labs or overwrite the verdict.
  it('does not apply a result to an action that was already settled', async () => {
    const { recoveryActionId, incidentId, labIds } = await approved();
    await prisma.recoveryAction.update({
      where: { id: recoveryActionId },
      data: { status: 'running', executedAt: new Date() },
    });
    await prisma.lab.updateMany({ where: { id: { in: labIds } }, data: { status: 'recovering' } });
    await prisma.incident.update({ where: { id: incidentId }, data: { status: 'recovering' } });
    await prisma.$transaction((tx) => job.onExhausted!({ recoveryActionId }, tx));

    const late = new Map(labIds.map((id) => [id, 'ready' as const]));

    expect(await applyAndVerify(recoveryActionId, incidentId, late)).toBe('skipped');
    expect(await labStatuses(labIds)).toEqual(['failed', 'failed']);
    expect(await actionOf(recoveryActionId)).toMatchObject({ status: 'failed' });
  });

  // Negative: out of retries mid-recovery, nothing may hang in recovering.
  it('settles an exhausted job without leaving labs recovering', async () => {
    const { recoveryActionId, incidentId, labIds } = await approved();
    await prisma.recoveryAction.update({
      where: { id: recoveryActionId },
      data: { status: 'running', executedAt: new Date() },
    });
    await prisma.lab.updateMany({ where: { id: { in: labIds } }, data: { status: 'recovering' } });
    await prisma.incident.update({ where: { id: incidentId }, data: { status: 'recovering' } });

    await prisma.$transaction((tx) => job.onExhausted!({ recoveryActionId }, tx));

    expect(await actionOf(recoveryActionId)).toMatchObject({ status: 'failed' });
    expect(await labStatuses(labIds)).toEqual(['failed', 'failed']);
    expect((await incidentOf(incidentId)).status).toBe('manual_review');
  });
});
