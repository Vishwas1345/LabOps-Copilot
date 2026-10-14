import type { Worker } from 'bullmq';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { ingestEvent } from '../events/service.js';
import { createLogger } from '../observability/logger.js';
import { initTracing } from '../observability/tracing.js';
import type { JobMessage } from './queues.js';
import { closeQueues } from './queues.js';
import { createWorker } from './worker.js';

// One incident must be one trace across processes (CLAUDE.md 9).
const exporter = new InMemorySpanExporter();
const provider = initTracing({
  serviceName: 'trace-test',
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
let worker: Worker<JobMessage> | undefined;
const lab = await prisma.lab.create({ data: { name: 'trace-test' } });

afterAll(async () => {
  await worker?.close();
  await closeQueues();
  await prisma.lab.delete({ where: { id: lab.id } });
  await provider.shutdown();
  await prisma.$disconnect();
});

describe('trace propagation', () => {
  it('continues the ingest trace in the worker', async () => {
    worker = createWorker(
      'correlate',
      // A stub handler: this worker also drains other files' queued jobs, and
      // real correlation of their labs would outlive their cleanup.
      { correlate: { span: 'incident.correlate', handle: async () => undefined } },
      createLogger(undefined, 'silent'),
    );

    const { jobId } = await ingestEvent(
      {
        providerEventId: `trace-${lab.id}`,
        labId: lab.id,
        type: 'provision_failed',
        errorCategory: 'PROVISION_TIMEOUT',
        message: 'timed out',
        // A window no other test uses, so no other job shares this key.
        occurredAt: '2025-06-01T03:00:00.000Z',
        source: 'provider',
      },
      { type: 'system', id: 'trace-test' },
    );

    // The worker may also run other files' jobs; find the span for ours.
    const isOurs = (s: { name: string; attributes: Record<string, unknown> }) =>
      s.name === 'incident.correlate' && s.attributes['labops.job.id'] === jobId;
    const deadline = Date.now() + 20_000;
    while (!exporter.getFinishedSpans().some(isOurs) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const spans = exporter.getFinishedSpans();
    const ingest = spans.find((s) => s.name === 'event.ingest');
    const correlate = spans.find(isOurs);
    expect(jobId).not.toBeNull();
    expect(ingest).toBeDefined();
    expect(correlate).toBeDefined();
    expect(correlate!.spanContext().traceId).toBe(ingest!.spanContext().traceId);
  }, 30_000);
});
