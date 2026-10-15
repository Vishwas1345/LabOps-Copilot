// Metrics from a real run: a scenario driven through the production paths,
// then the endpoint read before and after. Files run one at a time, so the
// deltas belong to this run.

import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { signedInCookie } from '../auth/session.fixture.js';
import { loadConfig } from '../config/env.js';
import { prisma } from '../db.js';
import { correlationWindow } from '../events/correlation-window.js';
import { ingestEvent } from '../events/service.js';
import { correlateWindow } from '../incidents/correlate.job.js';
import { fixtureProvider } from '../investigations/fixture-provider.js';
import { createInvestigateJob } from '../investigations/investigate.job.js';
import { investigateJobKey, requestInvestigation } from '../investigations/service.js';
import { createSimulatedLabs } from '../labs/service.js';
import { createTrainingEvent } from '../labs/simulator.js';
import { createLogger } from '../observability/logger.js';
import { approveAction, executeJobKey } from '../recovery/approve.js';
import { createExecuteJob } from '../recovery/execute.job.js';
import type { Metrics } from './service.js';
import { collectMetrics } from './service.js';

const app = await buildApp({ config: { ...loadConfig(), DEMO_ENABLED: false } });
const { cookie, operatorId } = await signedInCookie();
const OPERATOR = { type: 'human', id: operatorId } as const;
const log = createLogger(undefined, 'silent');
const scenario = createTrainingEvent(8_888, new Date('2020-06-01T09:00:00.000Z'));
const labIds = scenario.labs.map((lab) => lab.id);

afterAll(async () => {
  await prisma.incident.deleteMany({ where: { labs: { some: { labId: { in: labIds } } } } });
  await prisma.lab.deleteMany({ where: { id: { in: labIds } } });
  await prisma.dependency.deleteMany({ where: { id: { in: scenario.dependencies.map((d) => d.id) } } });
  await app.close();
  await prisma.$disconnect();
});

const readMetrics = async (query = ''): Promise<{ status: number; body: string; data: Metrics }> => {
  const response = await app.inject({ method: 'GET', url: `/api/metrics${query}`, headers: { cookie } });
  return { status: response.statusCode, body: response.body, data: response.json().data };
};

async function runStoredJob(jobKey: string, handle: (payload: unknown) => Promise<unknown>) {
  const row = await prisma.jobExecution.findUniqueOrThrow({ where: { jobKey } });
  return handle(row.payload);
}

describe('GET /api/metrics', () => {
  it('counts a real run, from ingest to verified recovery', async () => {
    const before = await readMetrics();

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
      include: { labs: true },
    });
    const burst = incidents.find((incident) => incident.labs.length === 12)!;
    const { investigationId } = await requestInvestigation(burst.id, OPERATOR);
    await runStoredJob(investigateJobKey(investigationId), (payload) =>
      createInvestigateJob(fixtureProvider, { timeoutMs: 2000, approvalTtlMs: 60_000 }).handle(payload, log),
    );
    const proposal = await prisma.recoveryAction.findFirstOrThrow({ where: { incidentId: burst.id } });
    await approveAction(proposal.id, OPERATOR);
    await runStoredJob(executeJobKey(proposal.id), (payload) => createExecuteJob().handle(payload, log));

    const after = await readMetrics();
    const { data } = after;
    expect(after.status).toBe(200);
    // The scenario already redelivers one event; each logical event counts once.
    const logical = new Set(scenario.events.map((event) => event.providerEventId)).size;
    expect(logical).toBeLessThan(scenario.events.length);
    expect(data.events.received - before.data.events.received).toBe(logical);
    expect(data.incidents.created - before.data.incidents.created).toBe(incidents.length);
    expect(data.incidents.timeToIdentify.samples).toBeGreaterThan(before.data.incidents.timeToIdentify.samples);
    expect(data.incidents.timeToIdentify.p50Ms).toBeGreaterThanOrEqual(0);
    expect(
      data.investigations.byStatus.completed - before.data.investigations.byStatus.completed,
    ).toBe(1);
    expect(data.investigations.latency.p50Ms).not.toBeNull();
    expect(data.recovery.byStatus.succeeded - before.data.recovery.byStatus.succeeded).toBe(1);
    expect(data.recovery.approvalToVerified.samples).toBe(
      before.data.recovery.approvalToVerified.samples + 1,
    );
    expect(data.recovery.approvalToVerified.p50Ms).toBeGreaterThanOrEqual(0);
    expect(data.queues.map((queue) => queue.queue)).toEqual(['correlate', 'investigate', 'execute']);

    // Aggregates only: no lab, incident or event detail leaves this endpoint.
    for (const id of [burst.id, ...labIds.slice(0, 5)]) expect(after.body).not.toContain(id);
    expect(after.body).not.toContain(scenario.events[0].message);
  }, 60_000);

  // Negative: an empty window is unknown, not zero milliseconds.
  it('reports zero counts and null durations when nothing happened', async () => {
    const data = await collectMetrics(1, new Date('2999-01-01T00:00:00.000Z'));

    expect(data.events.received).toBe(0);
    expect(data.incidents).toEqual({
      created: 0,
      timeToIdentify: { samples: 0, p50Ms: null, p95Ms: null },
    });
    expect(Object.values(data.recovery.byStatus).every((count) => count === 0)).toBe(true);
    expect(data.recovery.approvalToVerified.p50Ms).toBeNull();
    expect(data.investigations.latency.p50Ms).toBeNull();
  });

  it('sees a transaction held open, which would delay live updates', async () => {
    let release!: () => void;
    let opened!: () => void;
    const isOpen = new Promise<void>((resolve) => (opened = resolve));
    const held = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        opened();
        await new Promise<void>((resolve) => (release = resolve));
      },
      { timeout: 10_000 },
    );
    await isOpen;
    await new Promise((resolve) => setTimeout(resolve, 300));

    const { data } = await readMetrics();
    release();
    await held;

    expect(data.oldestOpenTransactionMs).toBeGreaterThanOrEqual(250);
  });

  it('refuses an anonymous request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(response.statusCode).toBe(401);
  });

  it.each(['?hours=0', '?hours=169', '?hours=abc', '?since=2020'])(
    'refuses an out-of-range window: %s',
    async (query) => {
      expect((await readMetrics(query)).status).toBe(400);
    },
  );
});
