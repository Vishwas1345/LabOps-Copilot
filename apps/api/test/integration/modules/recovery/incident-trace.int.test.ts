// One incident is one trace: born in correlation, joined by the investigation
// and the recovery, even though operators act minutes later in new requests.

import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
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
import { createTrainingEvent } from '../../../../src/modules/labs/simulator.js';
import { createLogger } from '../../../../src/platform/observability/logger.js';
import { initTracing, withSpan, withTraceparent } from '../../../../src/platform/observability/tracing.js';
import { approveAction, executeJobKey } from '../../../../src/modules/recovery/services/approve.js';

const exporter = new InMemorySpanExporter();
const provider = initTracing({ serviceName: 'incident-trace-test', spanProcessors: [new SimpleSpanProcessor(exporter)] });
const log = createLogger(undefined, 'silent');
const { operatorId } = await signedInCookie();
const OPERATOR = { type: 'human', id: operatorId } as const;
const scenario = createTrainingEvent(9_191, new Date('2020-07-06T09:00:00.000Z'));
const labIds = scenario.labs.map((lab) => lab.id);

afterAll(async () => {
  await prisma.incident.deleteMany({ where: { labs: { some: { labId: { in: labIds } } } } });
  await prisma.lab.deleteMany({ where: { id: { in: labIds } } });
  await prisma.dependency.deleteMany({ where: { id: { in: scenario.dependencies.map((d) => d.id) } } });
  await provider.shutdown();
  await prisma.$disconnect();
});

const traceIdOf = (traceparent: string | null | undefined) => traceparent?.split('-')[1];
const jobTrace = async (jobKey: string) =>
  traceIdOf((await prisma.jobExecution.findUniqueOrThrow({ where: { jobKey } })).traceparent);

describe('incident trace', () => {
  it('keeps investigation and recovery in the trace the incident was born in', async () => {
    await prisma.$transaction((tx) => createSimulatedLabs(tx, scenario));
    for (const event of scenario.events) await ingestEvent(event, OPERATOR);
    const burstEvent = scenario.events.find((event) => event.errorCategory === 'PROVISION_TIMEOUT')!;
    // As the runner does: correlation runs inside its own span.
    await withSpan('incident.correlate', () =>
      correlateWindow(correlationWindow(new Date(burstEvent.occurredAt)).start, log),
    );
    const incident = await prisma.incident.findFirstOrThrow({
      where: { labs: { some: { labId: burstEvent.labId } } },
    });
    const born = traceIdOf(incident.traceparent);
    expect(born).toMatch(/^[0-9a-f]{32}$/);

    // A new operator request, outside any span: it must still join.
    const { investigationId } = await requestInvestigation(incident.id, OPERATOR);
    expect(await jobTrace(investigateJobKey(investigationId))).toBe(born);
    const queued = exporter.getFinishedSpans().find((span) => span.name === 'investigation.queue');
    expect(queued?.spanContext().traceId).toBe(born);
    // Named, so a trace viewer can tell the api from the worker.
    expect(queued?.resource.attributes['service.name']).toBe('incident-trace-test');

    const row = await prisma.jobExecution.findUniqueOrThrow({ where: { jobKey: investigateJobKey(investigationId) } });
    await withTraceparent(row.traceparent, () =>
      createInvestigateJob(fixtureProvider, { timeoutMs: 2000, approvalTtlMs: 60_000 }).handle(row.payload, log),
    );
    const proposal = await prisma.recoveryAction.findFirstOrThrow({ where: { incidentId: incident.id } });

    await approveAction(proposal.id, OPERATOR);
    expect(await jobTrace(executeJobKey(proposal.id))).toBe(born);
  }, 60_000);
});
