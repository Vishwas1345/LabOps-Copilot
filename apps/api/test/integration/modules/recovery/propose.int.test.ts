import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/app.js';
import { signedInCookie } from '../../../fixtures/session.fixture.js';
import { loadConfig } from '../../../../src/platform/config/env.js';
import { prisma } from '../../../../src/db.js';
import { correlationWindow } from '../../../../src/modules/events/correlation-window.js';
import { ingestEvent } from '../../../../src/modules/events/service.js';
import { correlateWindow } from '../../../../src/modules/incidents/jobs/correlate.job.js';
import type { IncidentStatus } from '../../../../src/modules/incidents/transitions.js';
import { fixtureProvider } from '../../../../src/modules/investigations/providers/fixture-provider.js';
import { createInvestigateJob } from '../../../../src/modules/investigations/jobs/investigate.job.js';
import type { InvestigationOutput } from '../../../../src/modules/investigations/output-schema.js';
import { requestInvestigation } from '../../../../src/modules/investigations/service.js';
import { createLogger } from '../../../../src/platform/observability/logger.js';

const log = createLogger(undefined, 'silent');
const app = await buildApp({ config: { ...loadConfig(), DEMO_ENABLED: false } });
const { cookie, operatorId } = await signedInCookie();
const ACTOR = { type: 'human', id: operatorId } as const;
const labs: string[] = [];
const dependencies: string[] = [];

afterAll(async () => {
  await prisma.incident.deleteMany({ where: { labs: { some: { labId: { in: labs } } } } });
  await prisma.lab.deleteMany({ where: { id: { in: labs } } });
  await prisma.dependency.deleteMany({ where: { id: { in: dependencies } } });
  await app.close();
  await prisma.$disconnect();
});

// Each call uses its own day in 2022, so no two tests share a correlation window.
let day = 0;
async function incident(
  options: { count?: number; category?: string; status?: IncidentStatus } = {},
): Promise<{ incidentId: string; labIds: string[]; dependencyId: string }> {
  day += 1;
  const base = Date.UTC(2022, 0, day, 10, 1);
  const dep = await prisma.dependency.create({ data: { kind: 'image-registry' } });
  dependencies.push(dep.id);
  const labIds: string[] = [];
  for (let i = 0; i < (options.count ?? 2); i += 1) {
    const lab = await prisma.lab.create({ data: { name: 'propose-test' } });
    labs.push(lab.id);
    labIds.push(lab.id);
    await ingestEvent(
      {
        providerEventId: randomUUID(),
        labId: lab.id,
        type: 'provision_failed',
        errorCategory: options.category ?? 'PROVISION_TIMEOUT',
        dependencyId: dep.id,
        message: 'provisioning failed',
        occurredAt: new Date(base + i * 60_000).toISOString(),
        source: 'provider',
      },
      ACTOR,
    );
  }
  await correlateWindow(correlationWindow(new Date(base)).start, log);
  const { incidentId } = await prisma.incidentLab.findFirstOrThrow({ where: { labId: labIds[0] } });
  // Test setup only: the state an operator would reach through investigation.
  await prisma.incident.update({
    where: { id: incidentId },
    data: { status: options.status ?? 'manual_review' },
  });
  return { incidentId, labIds, dependencyId: dep.id };
}

const propose = (incidentId: string, body: object) =>
  app.inject({
    method: 'POST',
    url: `/api/incidents/${incidentId}/recovery-proposals`,
    headers: { cookie },
    payload: body,
  });

const statusOf = async (incidentId: string) =>
  (await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })).status;

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

const retry = (targetIds: string[]) => ({ actionType: 'RETRY_PROVISIONING', targetIds });

describe('POST /api/incidents/:id/recovery-proposals', () => {
  it('records an allowed retry, awaiting approval with an expiry', async () => {
    const { incidentId, labIds } = await incident();

    const response = await propose(incidentId, retry(labIds));

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ status: 'awaiting_approval', blockedAt: null });
    expect(await statusOf(incidentId)).toBe('awaiting_approval');
    const action = await prisma.recoveryAction.findUniqueOrThrow({
      where: { id: response.json().data.recoveryActionId },
    });
    expect(action.proposedBy).toBe(operatorId);
    expect(action.expiresAt!.getTime() - action.createdAt.getTime()).toBeCloseTo(30 * 60_000, -3);
    const decisions = action.policyDecisions as Array<{ step: string; passed: boolean }>;
    expect(decisions.map((d) => d.step)).toEqual([
      'structural',
      'target',
      'state',
      'concurrency',
      'rate_limit',
    ]);
    const audit = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'recovery.proposed', targetId: action.id },
    });
    expect(audit).toMatchObject({ actorId: operatorId, outcome: 'awaiting_approval' });
  });

  // The demo's deterministic blocked case (PLAN Phase 8).
  it('blocks a retry on a permission failure at the state step, and audits why', async () => {
    const { incidentId, labIds } = await incident({ category: 'PERMISSION_DENIED' });

    const response = await propose(incidentId, retry(labIds));

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ status: 'rejected_by_policy', blockedAt: 'state' });
    expect(await statusOf(incidentId)).toBe('manual_review');
    const audit = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'recovery.proposed', targetId: response.json().data.recoveryActionId },
    });
    expect(audit.metadata).toMatchObject({
      blockedAt: 'state',
      reason: expect.stringMatching(/cannot fix missing permissions/),
    });
  });

  it.each<[string, (ctx: { labIds: string[]; dependencyId: string }) => object, string]>([
    ['a target outside the incident', ({ labIds }) => retry([labIds[0], 'lab-not-in-incident']), 'target'],
    ['parameters', ({ labIds }) => ({ ...retry(labIds), parameters: { command: 'reboot' } }), 'structural'],
    ['targets on an escalation', ({ labIds }) => ({ actionType: 'ESCALATE_MANUAL', targetIds: labIds }), 'structural'],
    ['a lab dependency id as a lab', ({ dependencyId }) => retry([dependencyId]), 'target'],
  ])('blocks %s at the right step', async (_label, body, step) => {
    const ctx = await incident();

    const response = await propose(ctx.incidentId, body(ctx));

    expect(response.json().data).toMatchObject({ status: 'rejected_by_policy', blockedAt: step });
  });

  it('blocks a lab that is no longer failed', async () => {
    const { incidentId, labIds } = await incident();
    await prisma.lab.update({ where: { id: labIds[0] }, data: { status: 'ready' } });

    const response = await propose(incidentId, retry(labIds));

    expect(response.json().data.blockedAt).toBe('state');
  });

  it('blocks a second retry inside the cooldown', async () => {
    const { incidentId, labIds } = await incident();
    await prisma.recoveryAction.create({
      data: {
        incidentId,
        actionType: 'RETRY_PROVISIONING',
        targetIds: [labIds[0]],
        parameters: {},
        status: 'failed',
        idempotencyKey: `seed-${randomUUID()}`,
        proposedBy: operatorId,
        policyDecisions: [],
        executedAt: new Date(Date.now() - 5 * 60_000),
      },
    });

    const response = await propose(incidentId, retry(labIds));

    expect(response.json().data.blockedAt).toBe('rate_limit');
  });

  it('blocks a target already in another unfinished action', async () => {
    const { incidentId, labIds } = await incident();
    await prisma.recoveryAction.create({
      data: {
        incidentId,
        actionType: 'RERUN_VALIDATION',
        targetIds: [labIds[1]],
        parameters: {},
        status: 'approved',
        idempotencyKey: `seed-${randomUUID()}`,
        proposedBy: operatorId,
        policyDecisions: [],
      },
    });

    const response = await propose(incidentId, retry(labIds));

    expect(response.json().data.blockedAt).toBe('concurrency');
  });

  it('allows a dependency recheck and an escalation', async () => {
    const a = await incident();
    const b = await incident();

    const recheck = await propose(a.incidentId, {
      actionType: 'RECHECK_DEPENDENCY',
      targetIds: [a.dependencyId],
    });
    const escalate = await propose(b.incidentId, { actionType: 'ESCALATE_MANUAL', targetIds: [] });

    expect(recheck.json().data.status).toBe('awaiting_approval');
    expect(escalate.json().data.status).toBe('awaiting_approval');
  });

  // Negative: a repeat must not create a second proposal.
  it('returns the existing proposal on a repeat, whatever the target order', async () => {
    const { incidentId, labIds } = await incident();

    const first = await propose(incidentId, retry(labIds));
    const repeat = await propose(incidentId, retry([...labIds].reverse()));

    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().data.recoveryActionId).toBe(first.json().data.recoveryActionId);
    expect(await prisma.recoveryAction.count({ where: { incidentId } })).toBe(1);
  });

  // Negative: two proposals racing for one incident. The test holds the
  // incident row so both are mid-transaction at once, then lets them go.
  it('serialises concurrent proposals so both get the same one', async () => {
    const { incidentId, labIds } = await incident();

    let racing: Promise<Awaited<ReturnType<typeof propose>>>[] = [];
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Incident" WHERE id = ${incidentId} FOR UPDATE`;
      racing = [propose(incidentId, retry(labIds)), propose(incidentId, retry(labIds))];
      await untilBlocked(2);
    });
    const responses = await Promise.all(racing);

    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(new Set(responses.map((r) => r.json().data.recoveryActionId)).size).toBe(1);
  });

  // Negative: the probe that found this. A proposal accepted mid-investigation
  // was orphaned when the investigation moved the incident on.
  it('refuses an operator proposal while an investigation is running', async () => {
    const { incidentId, labIds } = await incident({ count: 1, status: 'open' });
    const { investigationId } = await requestInvestigation(incidentId, ACTOR);

    const response = await propose(incidentId, retry(labIds));
    await createInvestigateJob(fixtureProvider, {
      timeoutMs: 1000,
      approvalTtlMs: 30 * 60_000,
    }).handle({ investigationId }, log);

    expect(response.statusCode).toBe(409);
    expect(await prisma.recoveryAction.count({ where: { incidentId } })).toBe(0);
    // The single-lab diagnosis is insufficient, and nothing is left dangling.
    expect(await statusOf(incidentId)).toBe('open');
  });

  it.each<[string, () => Promise<string>, object, number]>([
    ['an unknown incident', async () => 'does-not-exist', retry([]), 404],
    ['an incident that is open', async () => (await incident({ status: 'open' })).incidentId, retry(['x']), 409],
    ['an incident still investigating', async () => (await incident({ status: 'investigating' })).incidentId, retry(['x']), 409],
    ['an action outside the allow-list', async () => (await incident()).incidentId, { actionType: 'DELETE_LAB', targetIds: [] }, 400],
    ['an unknown field', async () => (await incident()).incidentId, { ...retry(['x']), approvedBy: 'me' }, 400],
  ])('rejects %s', async (_label, incidentIdOf, body, status) => {
    expect((await propose(await incidentIdOf(), body)).statusCode).toBe(status);
  });

  it('lists an incident\'s actions with their decisions', async () => {
    const { incidentId, labIds } = await incident();
    await propose(incidentId, retry(labIds));

    const response = await app.inject({
      method: 'GET',
      url: `/api/incidents/${incidentId}/recovery-actions`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({
      actionType: 'RETRY_PROVISIONING',
      status: 'awaiting_approval',
      policyDecisions: expect.any(Array),
    });
  });
});

describe('automatic proposal after an investigation', () => {
  const recommending = (change: Partial<InvestigationOutput>) =>
    createInvestigateJob(
      {
        name: 'stub',
        model: 'stub',
        analyse: async () => ({
          raw: {
            outcome: 'diagnosis',
            summary: 'stub diagnosis',
            candidateCause: 'stub',
            evidenceFor: [],
            evidenceAgainst: [],
            missingEvidence: [],
            diagnosticChecks: [],
            confidence: 0.5,
            recommendedAction: 'RETRY_PROVISIONING',
            targetLabIds: [],
            ...change,
          },
        }),
      },
      { timeoutMs: 1000, approvalTtlMs: 30 * 60_000 },
    );

  async function investigate(
    ctx: { incidentId: string },
    change: Partial<InvestigationOutput>,
  ): Promise<void> {
    const { investigationId } = await requestInvestigation(ctx.incidentId, ACTOR);
    await recommending(change).handle({ investigationId }, log);
  }

  // Negative: the model recommended a retry policy forbids; nothing is
  // offered for approval, and the incident goes to manual review.
  it('sends a blocked recommendation to manual review', async () => {
    const ctx = await incident({ category: 'PERMISSION_DENIED', status: 'open' });

    await investigate(ctx, { targetLabIds: ctx.labIds });

    expect(await statusOf(ctx.incidentId)).toBe('manual_review');
    const action = await prisma.recoveryAction.findFirstOrThrow({
      where: { incidentId: ctx.incidentId },
    });
    expect(action).toMatchObject({ status: 'rejected_by_policy', blockedAt: 'state' });
  });

  it('targets the incident\'s dependencies for a dependency recheck', async () => {
    const ctx = await incident({ status: 'open' });

    await investigate(ctx, { recommendedAction: 'RECHECK_DEPENDENCY', targetLabIds: ctx.labIds });

    const action = await prisma.recoveryAction.findFirstOrThrow({
      where: { incidentId: ctx.incidentId },
    });
    expect(action).toMatchObject({ targetIds: [ctx.dependencyId], status: 'awaiting_approval' });
    expect(await statusOf(ctx.incidentId)).toBe('awaiting_approval');
  });
});
