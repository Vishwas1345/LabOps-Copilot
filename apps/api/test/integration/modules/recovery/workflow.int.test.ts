// The backend milestone (LOC-62): the whole workflow, with no UI, through the
// same paths production uses. Jobs run from the payloads stored in their job
// rows (the outbox contract), and only the fixture model is ever called.

import { afterAll, describe, expect, it } from 'vitest';
import { listIncidentAudit } from '../../../../src/platform/audit/audit.js';
import { signedInCookie } from '../../../fixtures/session.fixture.js';
import { prisma } from '../../../../src/db.js';
import { correlationWindow } from '../../../../src/modules/events/correlation-window.js';
import { ingestEvent } from '../../../../src/modules/events/service.js';
import { correlateWindow } from '../../../../src/modules/incidents/jobs/correlate.job.js';
import { fixtureProvider } from '../../../../src/modules/investigations/providers/fixture-provider.js';
import { createInvestigateJob } from '../../../../src/modules/investigations/jobs/investigate.job.js';
import type { LlmProvider } from '../../../../src/modules/investigations/providers/provider.js';
import { investigateJobKey, requestInvestigation } from '../../../../src/modules/investigations/service.js';
import { createSimulatedLabs } from '../../../../src/modules/labs/service.js';
import { createTrainingEvent } from '../../../../src/modules/labs/simulator.js';
import { createLogger } from '../../../../src/platform/observability/logger.js';
import { approveAction, executeJobKey } from '../../../../src/modules/recovery/services/approve.js';
import { createExecuteJob } from '../../../../src/modules/recovery/jobs/execute.job.js';

const log = createLogger(undefined, 'silent');
const { operatorId } = await signedInCookie();
const OPERATOR = { type: 'human', id: operatorId } as const;
const LIMITS = { timeoutMs: 2000, approvalTtlMs: 30 * 60_000 };
// Its own seed and epoch, so no other data shares these windows.
const scenario = createTrainingEvent(7_777, new Date('2020-05-04T09:00:00.000Z'));
const labIds = scenario.labs.map((lab) => lab.id);

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

const incidentStatus = async (id: string) =>
  (await prisma.incident.findUniqueOrThrow({ where: { id } })).status;

describe('backend workflow, end to end', () => {
  it('runs scenario to verified resolution, and blocks a bad recommendation', async () => {
    // 1. Scenario: 40 simulated labs, events ingested through the API's path.
    await prisma.$transaction((tx) => createSimulatedLabs(tx, scenario));
    for (const event of scenario.events) await ingestEvent(event, OPERATOR);

    // 2. Correlation: every window the failures armed.
    const windows = new Set(
      scenario.events
        .filter((event) => event.type === 'provision_failed')
        .map((event) => correlationWindow(new Date(event.occurredAt)).start.getTime()),
    );
    for (const start of windows) await correlateWindow(new Date(start), log);

    const incidents = await prisma.incident.findMany({
      where: { labs: { some: { labId: { in: labIds } } } },
      include: { labs: true },
    });
    const burst = incidents.find((incident) => incident.labs.length === 12);
    expect(burst).toBeDefined();
    const burstId = burst!.id;
    const burstLabs = burst!.labs.map((lab) => lab.labId);

    // 3. Investigation with the fixture model -> diagnosis -> policy allows.
    const { investigationId } = await requestInvestigation(burstId, OPERATOR);
    await runStoredJob(investigateJobKey(investigationId), (payload) =>
      createInvestigateJob(fixtureProvider, LIMITS).handle(payload, log),
    );
    const proposal = await prisma.recoveryAction.findFirstOrThrow({ where: { incidentId: burstId } });
    expect(proposal).toMatchObject({ actionType: 'RETRY_PROVISIONING', status: 'awaiting_approval' });
    expect(await incidentStatus(burstId)).toBe('awaiting_approval');

    // 4. A human approves; the execute job revalidates, acts and verifies.
    await approveAction(proposal.id, OPERATOR);
    await runStoredJob(executeJobKey(proposal.id), (payload) =>
      createExecuteJob().handle(payload, log),
    );

    // 5. Verified, not assumed: every lab in the incident reads ready.
    expect(await incidentStatus(burstId)).toBe('resolved');
    const labs = await prisma.lab.findMany({ where: { id: { in: burstLabs } } });
    expect(labs.every((lab) => lab.status === 'ready')).toBe(true);
    const done = await prisma.recoveryAction.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(done).toMatchObject({
      status: 'succeeded',
      approvedBy: operatorId,
      verificationResult: { passed: true },
    });

    // 6. The blocked case: a model wrongly recommends a retry on a permission
    //    failure. Policy refuses at the state step; nothing is offered.
    const permission = incidents.find((incident) =>
      incident.labs.some((lab) =>
        scenario.events.some(
          (event) => event.labId === lab.labId && event.errorCategory === 'PERMISSION_DENIED',
        ),
      ),
    );
    expect(permission).toBeDefined();
    const wrongModel: LlmProvider = {
      name: 'stub',
      model: 'overconfident',
      analyse: async () => ({
        raw: {
          outcome: 'diagnosis',
          summary: 'Retry will fix it.',
          candidateCause: 'transient',
          evidenceFor: [],
          evidenceAgainst: [],
          missingEvidence: [],
          diagnosticChecks: [],
          confidence: 0.9,
          recommendedAction: 'RETRY_PROVISIONING',
          targetLabIds: permission!.labs.map((lab) => lab.labId),
        },
      }),
    };
    const second = await requestInvestigation(permission!.id, OPERATOR);
    await runStoredJob(investigateJobKey(second.investigationId), (payload) =>
      createInvestigateJob(wrongModel, LIMITS).handle(payload, log),
    );

    const blocked = await prisma.recoveryAction.findFirstOrThrow({
      where: { incidentId: permission!.id },
    });
    expect(blocked).toMatchObject({ status: 'rejected_by_policy', blockedAt: 'state' });
    expect(await incidentStatus(permission!.id)).toBe('manual_review');
    await expect(approveAction(blocked.id, OPERATOR)).rejects.toThrow();

    // 7. The incident's own history holds every step, including those that
    //    name it in metadata, and nothing that belongs to another incident.
    const history = (await listIncidentAudit(burstId)).map((entry) => entry.action);
    for (const step of [
      'incident.created',
      'investigation.requested',
      'recovery.proposed',
      'recovery.approved',
      'recovery.started',
      'recovery.verified',
    ]) {
      expect(history).toContain(step);
    }
    const permissionHistory = await listIncidentAudit(permission!.id);
    expect(permissionHistory.map((entry) => entry.action)).not.toContain('recovery.approved');
    const burstSeqs = new Set((await listIncidentAudit(burstId)).map((entry) => entry.seq));
    expect(permissionHistory.some((entry) => burstSeqs.has(entry.seq))).toBe(false);
  }, 60_000);
});
