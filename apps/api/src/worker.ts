// Worker process entrypoint. Runs jobs, the reconciler and the approval
// expiry sweep; never serves HTTP.

import { loadConfig } from './config/env.js';
import { prisma } from './db.js';
import { handleCorrelate } from './incidents/correlate.job.js';
import { fixtureProvider } from './investigations/fixture-provider.js';
import { createInvestigateJob } from './investigations/investigate.job.js';
import { closeQueues } from './jobs/queues.js';
import { reconcileJobs } from './jobs/reconcile.js';
import { createExecuteJob } from './recovery/execute.job.js';
import { expireStaleApprovals } from './recovery/expire.js';
import { createWorker } from './jobs/worker.js';
import { logger } from './observability/logger.js';
import { initTracing } from './observability/tracing.js';

const RECONCILE_INTERVAL_MS = 60_000;

async function main() {
  const config = loadConfig();
  const tracing = initTracing({
    serviceName: 'labops-worker',
    otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
  const log = logger.child({ process: 'worker' });

  // Only the fixture exists until Phase 11; config rejects any other name.
  const providers = { fixture: fixtureProvider };
  const investigate = createInvestigateJob(providers[config.LLM_PROVIDER], {
    timeoutMs: config.LLM_TIMEOUT_MS,
    approvalTtlMs: config.APPROVAL_TTL_MINUTES * 60_000,
  });
  const execute = createExecuteJob();
  const workers = [
    createWorker('correlate', { correlate: { span: 'incident.correlate', handle: handleCorrelate } }, log),
    createWorker('investigate', { investigate }, log),
    createWorker('execute', { execute }, log),
  ];

  const reconcile = () =>
    reconcileJobs(new Date(), {
      investigate: investigate.onExhausted,
      execute: execute.onExhausted,
    })
      .then((outcome) => log.info(outcome, 'reconciled jobs'))
      .catch((error: unknown) => log.error({ err: error }, 'reconcile failed'));
  const sweep = () =>
    expireStaleApprovals()
      .then((expired) => expired > 0 && log.info({ expired }, 'expired stale approvals'))
      .catch((error: unknown) => log.error({ err: error }, 'approval sweep failed'));
  // One tick for both housekeeping jobs; each is safe to run in every worker.
  const tick = () => Promise.all([reconcile(), sweep()]);
  await tick();
  const timer = setInterval(tick, RECONCILE_INTERVAL_MS);

  // Let the active job finish before exiting; BullMQ retries it if killed.
  const shutdown = (signal: NodeJS.Signals) => {
    void (async () => {
      log.info({ signal }, 'shutting down');
      clearInterval(timer);
      await Promise.all(workers.map((worker) => worker.close()));
      await closeQueues();
      await tracing.shutdown();
      await prisma.$disconnect();
      process.exit(0);
    })();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  log.info('worker started');
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
});
