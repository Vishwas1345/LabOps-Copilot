import { randomUUID } from 'node:crypto';
import type { Worker } from 'bullmq';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { createLogger } from '../observability/logger.js';
import type { JobMessage } from './queues.js';
import { closeQueues, getQueue, MAX_ATTEMPTS } from './queues.js';
import { reconcileJobs } from './reconcile.js';
import { dispatchJob, recordJob } from './record.js';
import type { ExhaustedHook, JobHandler } from './runner.js';
import { createWorker } from './worker.js';

const log = createLogger(undefined, 'silent');
let worker: Worker<JobMessage> | undefined;

afterEach(async () => {
  await worker?.close();
  worker = undefined;
});
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

const startWorker = (handle: JobHandler, onExhausted?: ExhaustedHook) => {
  worker = createWorker('correlate', { correlate: { span: 'test.job', handle, onExhausted } }, log);
};

async function enqueue(payload = { n: 1 }) {
  const record = await prisma.$transaction((tx) =>
    recordJob(tx, 'correlate', `test-${randomUUID()}`, payload, undefined),
  );
  await dispatchJob(record);
  return record;
}

/** Polls the Postgres mirror until the row matches; no fixed sleeps. */
async function rowWhen(id: string, done: (status: string) => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.jobExecution.findUniqueOrThrow({ where: { id } });
    if (done(row.status) || Date.now() > deadline) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('enqueue', () => {
  // Negative: the same logical job sent twice is one job, not two.
  it('collapses duplicate sends of one key into one job', async () => {
    const record = await enqueue();

    await dispatchJob(record);
    await dispatchJob(record);

    const jobs = await getQueue('correlate').getJobs(['delayed', 'waiting']);
    expect(jobs.filter((job) => job.id === record.jobKey)).toHaveLength(1);
    expect(await prisma.jobExecution.count({ where: { jobKey: record.jobKey } })).toBe(1);
  });
});

describe('worker', () => {
  it('runs a job and records success', async () => {
    let received: unknown;
    startWorker(async (payload) => {
      received = payload;
    });

    const record = await enqueue({ n: 7 });
    const row = await rowWhen(record.id, (s) => s === 'succeeded');

    expect(row.status).toBe('succeeded');
    expect(row.attempts).toBe(1);
    expect(received).toEqual({ n: 7 });
  });

  // Negative: a failing handler is retried, then failed and audited.
  it('retries, then marks the job failed with an audit entry', async () => {
    const exhausted: unknown[] = [];
    startWorker(
      async () => {
        throw new Error('downstream exploded password=hunter2');
      },
      // Runs once, in the transaction that fails the job, with its payload.
      async (payload) => {
        exhausted.push(payload);
      },
    );

    const record = await enqueue();
    const row = await rowWhen(record.id, (s) => s === 'failed', 30_000);

    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    // The stored summary is redacted, like everything else that persists.
    expect(row.errorSummary).toContain('password=[redacted]');
    const audit = await prisma.auditEntry.findFirst({
      where: { action: 'job.failed', targetId: record.id },
    });
    expect(audit?.outcome).toBe('failed');
    expect(exhausted).toEqual([{ n: 1 }]);
  }, 40_000);

  // Work that arrives while a run is active must not be lost.
  it('runs again when the key is re-armed during a run', async () => {
    let calls = 0;
    let release!: () => void;
    const firstRunMayFinish = new Promise<void>((resolve) => (release = resolve));
    startWorker(async () => {
      calls += 1;
      if (calls === 1) await firstRunMayFinish;
    });

    const record = await enqueue();
    await rowWhen(record.id, (s) => s === 'running');
    // New work for the same key while the first run is still active.
    const rearmed = await prisma.$transaction((tx) =>
      recordJob(tx, 'correlate', record.jobKey, { n: 2 }, undefined),
    );
    await dispatchJob(rearmed);
    release();

    const row = await rowWhen(record.id, (s) => s === 'succeeded' && calls >= 2);
    expect(calls).toBe(2);
    expect(row.generation).toBe(2);
    expect(row.status).toBe('succeeded');
  });
});

describe('reconcileJobs', () => {
  // Simulates a row whose Redis job was lost: old updatedAt, nothing in Redis.
  async function lostRow(attempts: number) {
    const row = await prisma.jobExecution.create({
      data: { queue: 'correlate', jobKey: `lost-${randomUUID()}`, payload: {}, attempts },
    });
    await prisma.$executeRaw`UPDATE "JobExecution" SET "updatedAt" = now() - interval '1 hour'
      WHERE id = ${row.id}`;
    return row;
  }

  // Negative: a job lost from Redis is resent, not left stuck.
  it('resends a stale job that Redis no longer has', async () => {
    const row = await lostRow(1);

    await reconcileJobs();

    expect(await getQueue('correlate').getJob(row.jobKey)).toBeDefined();
    const after = await prisma.jobExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('queued');
  });

  it('fails and audits a lost job that has used its attempts', async () => {
    const row = await lostRow(MAX_ATTEMPTS);

    await reconcileJobs();

    const after = await prisma.jobExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('failed');
    expect(
      await prisma.auditEntry.count({ where: { action: 'job.failed', targetId: row.id } }),
    ).toBe(1);
  });

  it('leaves a fresh row alone, even with no Redis job yet', async () => {
    const row = await prisma.jobExecution.create({
      data: { queue: 'correlate', jobKey: `fresh-${randomUUID()}`, payload: {} },
    });

    await reconcileJobs();

    expect(await getQueue('correlate').getJob(row.jobKey)).toBeUndefined();
  });
});
