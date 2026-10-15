// Test-only: a correlated incident of failed labs, optionally with a proposal
// awaiting approval, built through the real ingest, correlate and propose
// paths. Never imported by app code.

import { randomUUID } from 'node:crypto';
import type { Actor } from '../../src/platform/audit/audit.js';
import { prisma } from '../../src/db.js';
import { correlationWindow } from '../../src/modules/events/correlation-window.js';
import { ingestEvent } from '../../src/modules/events/service.js';
import { correlateWindow } from '../../src/modules/incidents/jobs/correlate.job.js';
import type { ActionType } from '../../src/modules/labs/actions.js';
import type { ErrorCategory } from '../../src/modules/labs/failures.js';
import { createLogger } from '../../src/platform/observability/logger.js';
import { proposeAction } from '../../src/modules/recovery/propose.js';

export interface FixtureIncident {
  incidentId: string;
  labIds: string[];
  dependencyId: string;
  recoveryActionId: string | null;
}

const created = { labs: [] as string[], dependencies: [] as string[] };

/** Each call needs its own day so incidents never share a correlation window. */
export async function failedIncident(
  day: Date,
  actor: Actor,
  options: {
    count?: number;
    category?: ErrorCategory;
    propose?: boolean;
    /** What to propose; a retry on every lab by default. */
    action?: ActionType;
    targets?: 'all' | 'first' | 'dependency' | 'none';
  } = {},
): Promise<FixtureIncident> {
  const dep = await prisma.dependency.create({ data: { kind: 'image-registry' } });
  created.dependencies.push(dep.id);
  const labIds: string[] = [];
  for (let i = 0; i < (options.count ?? 2); i += 1) {
    const lab = await prisma.lab.create({ data: { name: 'recovery-test' } });
    created.labs.push(lab.id);
    labIds.push(lab.id);
    await ingestEvent(
      {
        providerEventId: randomUUID(),
        labId: lab.id,
        type: 'provision_failed',
        errorCategory: options.category ?? 'PROVISION_TIMEOUT',
        dependencyId: dep.id,
        message: 'provisioning failed',
        occurredAt: new Date(day.getTime() + i * 60_000).toISOString(),
        source: 'provider',
      },
      actor,
    );
  }
  await correlateWindow(correlationWindow(day).start, createLogger(undefined, 'silent'));
  const { incidentId } = await prisma.incidentLab.findFirstOrThrow({ where: { labId: labIds[0] } });
  if (options.propose === false) {
    return { incidentId, labIds, dependencyId: dep.id, recoveryActionId: null };
  }
  // The state an operator reaches after review; then a real proposal.
  await prisma.incident.update({ where: { id: incidentId }, data: { status: 'manual_review' } });
  const proposal = await prisma.$transaction((tx) =>
    proposeAction(
      tx,
      incidentId,
      {
        actionType: options.action ?? 'RETRY_PROVISIONING',
        targetIds: { all: labIds, first: [labIds[0]], dependency: [dep.id], none: [] }[
          options.targets ?? 'all'
        ],
        parameters: {},
      },
      actor,
      { approvalTtlMs: 30 * 60_000 },
    ),
  );
  return { incidentId, labIds, dependencyId: dep.id, recoveryActionId: proposal.recoveryActionId };
}

export async function removeFixtures(): Promise<void> {
  await prisma.incident.deleteMany({ where: { labs: { some: { labId: { in: created.labs } } } } });
  await prisma.lab.deleteMany({ where: { id: { in: created.labs.splice(0) } } });
  await prisma.dependency.deleteMany({ where: { id: { in: created.dependencies.splice(0) } } });
}

/** Waits until `count` sessions in this database wait on a lock. */
export async function untilBlocked(count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [{ waiting }] = await prisma.$queryRaw<[{ waiting: number }]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (waiting >= count || Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
