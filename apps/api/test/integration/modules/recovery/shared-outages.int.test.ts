// The demo's second scenario through the same paths production uses, with the
// fixture model: the paths the training event never takes. A dependency
// recheck is approved and run, yet verification fails because a recheck
// changes no lab; a repeat recheck hits the cooldown; an escalation goes
// straight to a human; and the lookalike pair stays two incidents.

import { afterAll, describe, expect, it } from 'vitest';
import { signedInCookie } from '../../../fixtures/session.fixture.js';
import { prisma } from '../../../../src/db.js';
import { correlationWindow } from '../../../../src/modules/events/correlation-window.js';
import { ingestEvent } from '../../../../src/modules/events/service.js';
import { correlateWindow } from '../../../../src/modules/incidents/jobs/correlate.job.js';
import { fixtureProvider } from '../../../../src/modules/investigations/providers/fixture-provider.js';
import { createInvestigateJob } from '../../../../src/modules/investigations/jobs/investigate.job.js';
import { investigateJobKey, requestInvestigation } from '../../../../src/modules/investigations/service.js';
import { createSimulatedLabs } from '../../../../src/modules/labs/service.js';
import { createSharedOutages } from '../../../../src/modules/labs/simulator.js';
import { createLogger } from '../../../../src/platform/observability/logger.js';
import { approveAction, executeJobKey } from '../../../../src/modules/recovery/services/approve.js';
import { createExecuteJob } from '../../../../src/modules/recovery/jobs/execute.job.js';

const log = createLogger(undefined, 'silent');
const { operatorId } = await signedInCookie();
const OPERATOR = { type: 'human', id: operatorId } as const;
const LIMITS = { timeoutMs: 2000, approvalTtlMs: 30 * 60_000 };
// Its own seed and epoch, so no other data shares these windows.
const scenario = createSharedOutages(8_888, new Date('2020-06-08T09:00:00.000Z'));
const labIds = scenario.labs.map((lab) => lab.id);
const dependencyOf = (kind: string) => scenario.dependencies.find((d) => d.kind === kind)!.id;

afterAll(async () => {
  await prisma.incident.deleteMany({ where: { labs: { some: { labId: { in: labIds } } } } });
  await prisma.lab.deleteMany({ where: { id: { in: labIds } } });
  await prisma.dependency.deleteMany({ where: { id: { in: scenario.dependencies.map((d) => d.id) } } });
  await prisma.$disconnect();
});

/** Runs a queued job the way the worker would: from its stored payload. */
async function runStoredJob(jobKey: string, handle: (payload: unknown) => Promise<unknown>) {
  const row = await prisma.jobExecution.findUniqueOrThrow({ where: { jobKey } });
  return handle(row.payload);
}

async function investigate(incidentId: string) {
  const { investigationId } = await requestInvestigation(incidentId, OPERATOR);
  await runStoredJob(investigateJobKey(investigationId), (payload) =>
    createInvestigateJob(fixtureProvider, LIMITS).handle(payload, log),
  );
  return prisma.investigation.findUniqueOrThrow({ where: { id: investigationId } });
}

const newestAction = (incidentId: string) =>
  prisma.recoveryAction.findFirstOrThrow({ where: { incidentId }, orderBy: { createdAt: 'desc' } });

async function approveAndRun(actionId: string) {
  await approveAction(actionId, OPERATOR);
  await runStoredJob(executeJobKey(actionId), (payload) => createExecuteJob().handle(payload, log));
  return prisma.recoveryAction.findUniqueOrThrow({ where: { id: actionId } });
}

const incidentStatus = async (id: string) =>
  (await prisma.incident.findUniqueOrThrow({ where: { id } })).status;

describe('shared-outages scenario, end to end', () => {
  it('takes each of its incidents down a different path', async () => {
    await prisma.$transaction((tx) => createSimulatedLabs(tx, scenario));
    for (const event of scenario.events) await ingestEvent(event, OPERATOR);
    const windows = new Set(
      scenario.events
        .filter((event) => event.type === 'provision_failed')
        .map((event) => correlationWindow(new Date(event.occurredAt)).start.getTime()),
    );
    for (const start of windows) await correlateWindow(new Date(start), log);

    const incidents = await prisma.incident.findMany({
      where: { labs: { some: { labId: { in: labIds } } } },
      include: { labs: { include: { event: true } } },
    });
    const sizes = incidents.map((incident) => incident.labs.length).sort((a, b) => b - a);
    expect(sizes).toEqual([6, 5, 1, 1]);
    const byCategory = (category: string) =>
      incidents.filter((incident) => incident.labs[0].event.errorCategory === category);
    const [outage] = byCategory('DEPENDENCY_UNAVAILABLE');
    const [quota] = byCategory('QUOTA_EXCEEDED');

    // 1. The outage: the model recommends a recheck, which targets the
    //    incident's dependency (server-side truth), and policy allows it.
    expect(await investigate(outage.id)).toMatchObject({ recommendedAction: 'RECHECK_DEPENDENCY' });
    const recheck = await newestAction(outage.id);
    expect(recheck).toMatchObject({
      status: 'awaiting_approval',
      targetIds: [dependencyOf('license-server')],
    });
    expect(recheck.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await incidentStatus(outage.id)).toBe('awaiting_approval');

    // 2. Approved and run, yet not resolved: a recheck reads, changes no lab.
    expect(await approveAndRun(recheck.id)).toMatchObject({
      status: 'failed',
      verificationResult: { passed: false },
    });
    expect(await incidentStatus(outage.id)).toBe('manual_review');
    const outageLabs = await prisma.lab.findMany({
      where: { id: { in: outage.labs.map((lab) => lab.labId) } },
    });
    expect(outageLabs.every((lab) => lab.status === 'failed')).toBe(true);

    // 3. Investigated again at once: the same recheck is inside its cooldown.
    await investigate(outage.id);
    expect(await newestAction(outage.id)).toMatchObject({
      actionType: 'RECHECK_DEPENDENCY',
      status: 'rejected_by_policy',
      blockedAt: 'rate_limit',
    });
    expect(await incidentStatus(outage.id)).toBe('manual_review');

    // 4. The quota: no automated fix exists, so the model escalates, and the
    //    incident goes to a human with nothing offered for approval.
    expect(await investigate(quota.id)).toMatchObject({ recommendedAction: 'ESCALATE_MANUAL' });
    expect(await prisma.recoveryAction.count({ where: { incidentId: quota.id } })).toBe(0);
    expect(await incidentStatus(quota.id)).toBe('manual_review');

    // 5. A lookalike alone: not enough evidence, so nothing is proposed.
    const [lookalike] = byCategory('PROVISION_TIMEOUT');
    expect(await investigate(lookalike.id)).toMatchObject({
      outcome: 'insufficient_evidence',
      recommendedAction: null,
    });
    expect(await prisma.recoveryAction.count({ where: { incidentId: lookalike.id } })).toBe(0);
    expect(await incidentStatus(lookalike.id)).toBe('open');
  }, 60_000);
});
