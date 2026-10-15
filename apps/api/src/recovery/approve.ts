// Approve, reject and expire: status changes of a RecoveryAction, each under a
// row lock with its audit entry. Approval is permission to re-check, not to
// execute: the execute job re-runs policy against fresh state (execute.job.ts).

import type { Prisma, RecoveryActionStatus } from '@prisma/client';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import { incidentTraceparent, transitionIncident } from '../incidents/service.js';
import { dispatchJob, jobIdForKey, recordJob } from '../jobs/record.js';
import { logger } from '../observability/logger.js';
import { currentTraceparent } from '../observability/tracing.js';

export const executeJobKey = (recoveryActionId: string) => `execute-${recoveryActionId}`;

export class RecoveryActionNotFoundError extends Error {
  constructor(readonly recoveryActionId: string) {
    super(`recovery action not found: ${recoveryActionId}`);
    this.name = 'RecoveryActionNotFoundError';
  }
}

/** The action is not awaiting approval (already decided, expired or blocked). */
export class RecoveryActionConflictError extends Error {
  constructor(readonly status: RecoveryActionStatus) {
    super(`recovery action is ${status}`);
    this.name = 'RecoveryActionConflictError';
  }
}

export class ApprovalExpiredError extends Error {
  constructor() {
    super('the approval window has passed');
    this.name = 'ApprovalExpiredError';
  }
}

export interface LockedAction {
  id: string;
  incidentId: string;
  status: RecoveryActionStatus;
  expiresAt: Date | null;
  approvedAt: Date | null;
}

/** SELECT ... FOR UPDATE: concurrent decisions on one action run one at a time. */
export async function lockAction(
  tx: Prisma.TransactionClient,
  recoveryActionId: string,
): Promise<LockedAction> {
  const [row] = await tx.$queryRaw<LockedAction[]>`
    SELECT id, "incidentId", status, "expiresAt", "approvedAt"
    FROM "RecoveryAction" WHERE id = ${recoveryActionId} FOR UPDATE`;
  if (!row) throw new RecoveryActionNotFoundError(recoveryActionId);
  return row;
}

/** Past its window: the action expires and the incident goes to manual review. */
export async function expireAction(
  tx: Prisma.TransactionClient,
  action: LockedAction,
  actor: Actor,
): Promise<void> {
  await tx.recoveryAction.update({ where: { id: action.id }, data: { status: 'expired' } });
  await transitionIncident(tx, action.incidentId, 'manual_review', actor, {
    reason: 'approval window passed',
  });
  await writeAudit(tx, {
    actor,
    action: 'recovery.expired',
    targetType: 'recovery_action',
    targetId: action.id,
    outcome: 'expired',
    metadata: { incidentId: action.incidentId, expiresAt: action.expiresAt?.toISOString() },
  });
}

export interface Approval {
  jobId: string;
  /** False when the action was already approved and its job is returned. */
  created: boolean;
}

/**
 * Records the approver from the session and queues one execute job, keyed by
 * the action, so repeated or concurrent approvals collapse into one job.
 */
export async function approveAction(recoveryActionId: string, actor: Actor): Promise<Approval> {
  const outcome = await prisma.$transaction(async (tx) => {
    const action = await lockAction(tx, recoveryActionId);
    if (action.approvedAt) {
      const jobId = await jobIdForKey(executeJobKey(action.id));
      if (jobId) return { kind: 'existing' as const, jobId };
    }
    if (action.status !== 'awaiting_approval') {
      throw new RecoveryActionConflictError(action.status);
    }
    // Expiry is enforced here, not only by the sweep, so a late click loses.
    if (!action.expiresAt || action.expiresAt <= new Date()) {
      await expireAction(tx, action, actor);
      return { kind: 'expired' as const };
    }
    await tx.recoveryAction.update({
      where: { id: action.id },
      data: { status: 'approved', approvedBy: actor.id, approvedAt: new Date() },
    });
    const job = await recordJob(
      tx,
      'execute',
      executeJobKey(action.id),
      { recoveryActionId: action.id },
      // The execute job joins the incident's trace, not this request's.
      (await incidentTraceparent(tx, action.incidentId)) ?? currentTraceparent(),
    );
    await writeAudit(tx, {
      actor,
      action: 'recovery.approved',
      targetType: 'recovery_action',
      targetId: action.id,
      outcome: 'approved',
      metadata: { incidentId: action.incidentId },
    });
    return { kind: 'approved' as const, job };
  });

  // The expiry commits first; only then is the request refused.
  if (outcome.kind === 'expired') throw new ApprovalExpiredError();
  if (outcome.kind === 'existing') return { jobId: outcome.jobId, created: false };
  await dispatchJob(outcome.job).catch((error: unknown) =>
    logger.warn({ err: error, jobId: outcome.job.id }, 'dispatch failed; reconciler will retry'),
  );
  return { jobId: outcome.job.id, created: true };
}

/** An operator declines: the incident returns to open (ARCHITECTURE §7). */
export async function rejectAction(recoveryActionId: string, actor: Actor): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const action = await lockAction(tx, recoveryActionId);
    if (action.status !== 'awaiting_approval') {
      throw new RecoveryActionConflictError(action.status);
    }
    await tx.recoveryAction.update({ where: { id: action.id }, data: { status: 'rejected' } });
    await transitionIncident(tx, action.incidentId, 'open', actor, {
      reason: 'recovery action rejected',
    });
    await writeAudit(tx, {
      actor,
      action: 'recovery.rejected',
      targetType: 'recovery_action',
      targetId: action.id,
      outcome: 'rejected',
      metadata: { incidentId: action.incidentId },
    });
  });
}
