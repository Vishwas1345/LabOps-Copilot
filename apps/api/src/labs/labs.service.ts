import type { Prisma } from '@prisma/client';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import type { LabStatus } from './transitions.js';
import { assertTransition } from './transitions.js';

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

/**
 * The only way a lab's status changes. Runs inside the caller's transaction so
 * the status and its audit entry commit or roll back together.
 *
 * The write is conditional on the status we read (compare-and-set): if a
 * concurrent transaction moved the lab first, zero rows match and this throws
 * instead of overwriting their change. That avoids holding a row lock while
 * keeping two racing transitions from both winning.
 */
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
