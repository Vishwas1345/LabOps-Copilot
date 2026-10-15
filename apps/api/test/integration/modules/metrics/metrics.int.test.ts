// Metrics from a real run: a scenario driven through the production paths,
// then the endpoint read before and after. Files run one at a time, so the
// deltas belong to this run.

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/app.js';
import { signedInCookie } from '../../../fixtures/session.fixture.js';
import { loadConfig } from '../../../../src/platform/config/env.js';
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
import { approveAction, executeJobKey } from '../../../../src/modules/recovery/approve.js';
import { createExecuteJob } from '../../../../src/modules/recovery/jobs/execute.job.js';
import type { FailureSeries } from '../../../../src/modules/events/stats.js';
import type { Metrics } from '../../../../src/modules/metrics/service.js';
import { collectMetrics } from '../../../../src/modules/metrics/service.js';

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

const readSeries = async (query = ''): Promise<{ status: number; series: FailureSeries }> => {
  const response = await app.inject({ method: 'GET', url: `/api/metrics/series${query}`, headers: { cookie } });
  return { status: response.statusCode, series: response.json().data?.failures };
};

async function runStoredJob(jobKey: string, handle: (payload: unknown) => Promise<unknown>) {
  const row = await prisma.jobExecution.findUniqueOrThrow({ where: { jobKey } });
  return handle(row.payload);
}

describe('GET /api/metrics', () => {
  it('counts a real run, from ingest to verified recovery', async () => {
    const before = await readMetrics();
    const seriesBefore = (await readSeries()).series;

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

    // The timeline gains exactly this run's failures, each logical one once,
    // and its buckets add up to its totals.
    const { status: seriesStatus, series } = await readSeries();
    expect(seriesStatus).toBe(200);
    const failed = new Map<string, number>();
    for (const event of new Map(scenario.events.map((e) => [e.providerEventId, e])).values()) {
      if (event.type === 'provision_failed') {
        failed.set(event.errorCategory!, (failed.get(event.errorCategory!) ?? 0) + 1);
      }
    }
    for (const [category, count] of failed) {
      const key = category as keyof FailureSeries['totals'];
      expect(series.totals[key] - seriesBefore.totals[key]).toBe(count);
    }
    const bucketSum = series.buckets.reduce(
      (sum, bucket) => sum + Object.values(bucket.counts).reduce((a, b) => a + b, 0),
      0,
    );
    expect(bucketSum).toBe(Object.values(series.totals).reduce((a, b) => a + b, 0));
    expect(series.buckets.length).toBeLessThanOrEqual(61);
    expect(data.incidents.byStatusNow.resolved).toBeGreaterThan(before.data.incidents.byStatusNow.resolved);

    // Aggregates only: no lab, incident or event detail leaves this endpoint.
    for (const id of [burst.id, ...labIds.slice(0, 5)]) expect(after.body).not.toContain(id);
    expect(after.body).not.toContain(scenario.events[0].message);
  }, 60_000);

  // Negative (#22): the columns hold UTC without a zone, so a database whose
  // sessions run in another zone must report exactly the same window.
  it('reports the same window on a database that is not in UTC', async () => {
    // The raw-SQL figures are the ones at risk; Prisma's typed counts never were.
    const windowed = (m: Metrics) => [
      m.incidents.timeToIdentify.samples,
      m.investigations.latency.samples,
      m.recovery.approvalToVerified.samples,
      ...m.queues.map((queue) => queue.succeeded),
    ];
    // The run above drives its jobs directly, so give the jobs query a row too.
    const now = new Date();
    const job = await prisma.jobExecution.create({
      data: { queue: 'correlate', jobKey: `tz-${randomUUID()}`, payload: {}, status: 'succeeded', startedAt: now, finishedAt: now },
    });
    const utc = await collectMetrics(1);
    expect(windowed(utc).filter((value) => value === 0)).toHaveLength(2); // investigate, execute queues
    expect(utc.queues.find((queue) => queue.queue === 'correlate')?.succeeded).toBeGreaterThan(0);
    const [{ db }] = await prisma.$queryRaw<[{ db: string }]>`SELECT current_database() AS db`;
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone TO 'Asia/Kolkata'`);
    // New connections pick up the database default; pooled ones would not.
    await prisma.$disconnect();
    try {
      const [{ timezone }] = await prisma.$queryRaw<[{ timezone: string }]>`SELECT current_setting('TimeZone') AS timezone`;
      expect(timezone).toBe('Asia/Kolkata');
      const ist = await collectMetrics(1);
      expect(windowed(ist)).toEqual(windowed(utc));
    } finally {
      await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET timezone`);
      await prisma.$disconnect();
      await prisma.jobExecution.delete({ where: { id: job.id } });
    }
  });

  // Negative (#23): a sample is a measured duration, not a succeeded row.
  it('counts a job without a start time as succeeded but not as a sample', async () => {
    const correlate = async () => (await collectMetrics(1)).queues.find((queue) => queue.queue === 'correlate')!;
    const before = await correlate();
    const row = await prisma.jobExecution.create({
      data: { queue: 'correlate', jobKey: `metrics-${randomUUID()}`, payload: {}, status: 'succeeded', finishedAt: new Date() },
    });
    try {
      const after = await correlate();
      expect(after.succeeded).toBe(before.succeeded + 1);
      expect(after.run.samples).toBe(before.run.samples);
      expect(after.endToEnd.samples).toBe(before.endToEnd.samples + 1);
    } finally {
      await prisma.jobExecution.delete({ where: { id: row.id } });
    }
  });

  // Negative: an empty window is unknown, not zero milliseconds.
  it('reports zero counts and null durations when nothing happened', async () => {
    const data = await collectMetrics(1, new Date('2999-01-01T00:00:00.000Z'));

    expect(data.events.received).toBe(0);
    expect(data.incidents.created).toBe(0);
    expect(data.incidents.timeToIdentify).toEqual({ samples: 0, p50Ms: null, p95Ms: null });
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
    for (const url of ['/api/metrics', '/api/metrics/series']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
  });

  // Negative: an empty window is an empty timeline, not an error or a zero bucket.
  it('returns an empty timeline when nothing failed in the window', async () => {
    const { failureSeries } = await import('../../../../src/modules/events/stats.js');
    const series = await failureSeries(new Date('2999-01-01T00:00:00.000Z'));
    expect(series.bucketMs).toBeNull();
    expect(series.buckets).toEqual([]);
    expect(Object.values(series.totals).every((count) => count === 0)).toBe(true);
  });

  it.each(['?hours=0', '?hours=169', '?hours=abc', '?since=2020'])(
    'refuses an out-of-range window: %s',
    async (query) => {
      expect((await readMetrics(query)).status).toBe(400);
      expect((await readSeries(query)).status).toBe(400);
    },
  );
});
