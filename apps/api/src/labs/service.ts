import type { Lab, LabSource, Prisma } from '@prisma/client';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import type { ListLabsQuery } from './schemas.js';
import type { Scenario } from './simulator.js';
import type { LabStatus } from './transitions.js';
import { assertTransition, canTransition } from './transitions.js';

// The public shape of a lab, so a new column never widens the API by accident.
export interface LabView {
  id: string;
  name: string;
  labType: string;
  status: LabStatus;
  source: LabSource;
  dependencyIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LabPage {
  items: LabView[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

type LabWithDependencies = Lab & { dependencies: { dependencyId: string }[] };

export function toLabView(lab: LabWithDependencies): LabView {
  return {
    id: lab.id,
    name: lab.name,
    labType: lab.labType,
    status: lab.status,
    source: lab.source,
    dependencyIds: lab.dependencies.map((link) => link.dependencyId),
    createdAt: lab.createdAt.toISOString(),
    updatedAt: lab.updatedAt.toISOString(),
  };
}

const withDependencyIds = {
  dependencies: { select: { dependencyId: true } },
} as const;

// Newest first; `id` breaks ties so pages never skip or repeat a lab.
// One extra row tells us whether a next page exists, without a count query.
export async function listLabs(query: ListLabsQuery): Promise<LabPage> {
  const rows = await prisma.lab.findMany({
    where: query.status ? { status: query.status } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: withDependencyIds,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  return {
    items: page.map(toLabView),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function getLab(labId: string): Promise<LabView> {
  const lab = await prisma.lab.findUnique({
    where: { id: labId },
    include: withDependencyIds,
  });
  if (!lab) {
    throw new LabNotFoundError(labId);
  }
  return toLabView(lab);
}

export class LabNotFoundError extends Error {
  constructor(readonly labId: string) {
    super(`lab not found: ${labId}`);
    this.name = 'LabNotFoundError';
  }
}

/** Another transaction moved the lab between our read and our write. */
export class ConcurrentTransitionError extends Error {
  constructor(
    readonly labId: string,
    readonly expected: LabStatus,
  ) {
    super(`lab ${labId} is no longer ${expected}`);
    this.name = 'ConcurrentTransitionError';
  }
}

export interface LabTransition {
  from: LabStatus;
  to: LabStatus;
}

// The only way a lab's status changes; status and audit share the caller's
// transaction. Compare-and-set: a concurrent change makes the write match zero rows.
export async function transitionLab(
  tx: Prisma.TransactionClient,
  labId: string,
  to: LabStatus,
  actor: Actor,
  context: { correlationId?: string; reason?: string } = {},
): Promise<LabTransition> {
  const lab = await tx.lab.findUnique({
    where: { id: labId },
    select: { status: true },
  });
  if (!lab) {
    throw new LabNotFoundError(labId);
  }

  const from = lab.status;
  assertTransition(from, to);

  const { count } = await tx.lab.updateMany({
    where: { id: labId, status: from },
    data: { status: to },
  });
  if (count === 0) {
    throw new ConcurrentTransitionError(labId, from);
  }

  await writeAudit(tx, {
    actor,
    action: 'lab.transition',
    targetType: 'lab',
    targetId: labId,
    outcome: 'applied',
    correlationId: context.correlationId,
    metadata: { from, to, reason: context.reason },
  });

  return { from, to };
}

// Idempotent: ids come from the seed, so a re-run inserts nothing new.
// Returns how many labs this call created (0 on a replay).
export async function createSimulatedLabs(
  tx: Prisma.TransactionClient,
  scenario: Scenario,
): Promise<number> {
  await tx.dependency.createMany({
    data: scenario.dependencies.map((d) => ({ id: d.id, kind: d.kind })),
    skipDuplicates: true,
  });
  const { count } = await tx.lab.createMany({
    data: scenario.labs.map((lab) => ({
      id: lab.id,
      name: lab.name,
      labType: lab.labType,
      source: 'simulated',
    })),
    skipDuplicates: true,
  });
  await tx.labDependency.createMany({
    data: scenario.labs.flatMap((lab) =>
      lab.dependencyIds.map((dependencyId) => ({ labId: lab.id, dependencyId })),
    ),
    skipDuplicates: true,
  });
  return count;
}

// For event-driven changes: a late or repeated event that the state machine
// does not allow is still evidence, so it skips the move instead of throwing.
export async function tryTransitionLab(
  tx: Prisma.TransactionClient,
  labId: string,
  to: LabStatus,
  actor: Actor,
  context: { correlationId?: string; reason?: string } = {},
): Promise<LabTransition | null> {
  const lab = await tx.lab.findUnique({ where: { id: labId }, select: { status: true } });
  if (!lab) {
    throw new LabNotFoundError(labId);
  }
  if (!canTransition(lab.status, to)) {
    return null;
  }
  return transitionLab(tx, labId, to, actor, context);
}

/** Lab type by lab id, for correlation scoring. */
export async function labTypesOf(
  tx: Prisma.TransactionClient,
  labIds: string[],
): Promise<Map<string, string>> {
  const rows = await tx.lab.findMany({
    where: { id: { in: labIds } },
    select: { id: true, labType: true },
  });
  return new Map(rows.map((row) => [row.id, row.labType]));
}

/** Dependency kind by dependency id, so reasons read "image-registry", not an id. */
export async function dependencyKindsOf(
  tx: Prisma.TransactionClient,
  dependencyIds: string[],
): Promise<Map<string, string>> {
  const rows = await tx.dependency.findMany({
    where: { id: { in: dependencyIds } },
    select: { id: true, kind: true },
  });
  return new Map(rows.map((row) => [row.id, row.kind]));
}

/** Current status by lab id, read inside the caller's transaction. */
export async function labStatusesOf(
  tx: Prisma.TransactionClient,
  labIds: string[],
): Promise<Map<string, LabStatus>> {
  const rows = await tx.lab.findMany({
    where: { id: { in: labIds } },
    select: { id: true, status: true },
  });
  return new Map(rows.map((row) => [row.id, row.status]));
}
