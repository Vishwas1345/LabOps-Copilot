// Turns a recommended or operator-chosen action into a recorded proposal.
// The model never decides here: the incident is locked, server-side facts are
// gathered, and the pure policy evaluator judges steps 1-5. Allowed waits for
// approval; blocked is kept with the step and reason that stopped it.

import { createHash } from 'node:crypto';
import type { Prisma, RecoveryAction } from '@prisma/client';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import { lockIncidentScope, transitionIncident } from '../incidents/service.js';
import type { ActionType } from '../labs/actions.js';
import type { ErrorCategory } from '../labs/failures.js';
import { labStatusesOf } from '../labs/service.js';
import { withSpan } from '../observability/tracing.js';
import { ACTION_POLICIES } from '../policies/actions.js';
import type { PolicyFacts } from '../policies/evaluate.js';
import { evaluatePolicy, PROPOSAL_STEPS } from '../policies/evaluate.js';

export interface ActionRequest {
  actionType: ActionType;
  targetIds: string[];
  parameters: Record<string, unknown>;
}

export interface Proposal {
  recoveryActionId: string;
  status: RecoveryAction['status'];
  blockedAt: string | null;
  /** False when an unfinished proposal for the same action and targets was returned. */
  created: boolean;
}

/** The incident is not in a state that can take a proposal. */
export class ProposalConflictError extends Error {
  constructor(readonly incidentId: string) {
    super(`incident ${incidentId} cannot take a proposal now`);
    this.name = 'ProposalConflictError';
  }
}

// Each source owns one starting state, so two flows never move one incident:
// a diagnosis proposes from `investigating` (only the investigation leaves
// that state), an operator only from `manual_review`.
const startingState = (fromInvestigation: boolean) =>
  fromInvestigation ? 'investigating' : 'manual_review';
const UNFINISHED: RecoveryAction['status'][] = ['awaiting_approval', 'approved', 'running'];
const EXECUTED: RecoveryAction['status'][] = ['running', 'succeeded', 'failed'];

const targetsHash = (targetIds: readonly string[]) =>
  createHash('sha256').update([...targetIds].sort().join(',')).digest('hex').slice(0, 16);

async function gatherFacts(
  tx: Prisma.TransactionClient,
  request: ActionRequest,
  scope: Awaited<ReturnType<typeof lockIncidentScope>>,
  now: Date,
): Promise<PolicyFacts> {
  const statuses = await labStatusesOf(tx, scope.labIds);
  const targets = request.targetIds;
  const [busy, executed] = await Promise.all([
    tx.recoveryAction.findMany({
      where: { status: { in: UNFINISHED }, targetIds: { hasSome: targets } },
      select: { targetIds: true },
    }),
    tx.recoveryAction.findMany({
      where: {
        actionType: request.actionType,
        status: { in: EXECUTED },
        executedAt: { not: null },
        targetIds: { hasSome: targets },
      },
      select: { targetIds: true, executedAt: true },
    }),
  ]);
  const attempts = new Map<string, Date[]>();
  for (const row of executed) {
    for (const id of row.targetIds) {
      if (row.executedAt) attempts.set(id, [...(attempts.get(id) ?? []), row.executedAt]);
    }
  }
  return {
    incidentLabIds: new Set(scope.labIds),
    incidentDependencyIds: new Set(scope.dependencyIds),
    labs: new Map(
      scope.labIds.flatMap((id) => {
        const status = statuses.get(id);
        const category = (scope.categoryByLab.get(id) ?? null) as ErrorCategory | null;
        return status ? [[id, { status, category }] as const] : [];
      }),
    ),
    busyTargets: new Set(busy.flatMap((row) => row.targetIds).filter((id) => targets.includes(id))),
    attempts,
    now,
  };
}

/**
 * Runs in the caller's transaction. Idempotent: an unfinished proposal for the
 * same action and targets is returned instead of a second one.
 */
export function proposeAction(
  tx: Prisma.TransactionClient,
  incidentId: string,
  request: ActionRequest,
  actor: Actor,
  options: { approvalTtlMs: number; investigationId?: string },
): Promise<Proposal> {
  return withSpan('recovery.policy_check', async (span) => {
    const scope = await lockIncidentScope(tx, incidentId);
    const hash = targetsHash(request.targetIds);
    const keyPrefix = `${incidentId}:${request.actionType}:${hash}:`;
    // By incident and action (indexed), then the key prefix in memory: a LIKE
    // on the key cannot use its index under a locale collation.
    const sameAction = (
      await tx.recoveryAction.findMany({
        where: { incidentId, actionType: request.actionType },
        select: { id: true, status: true, blockedAt: true, idempotencyKey: true },
      })
    ).filter((row) => row.idempotencyKey.startsWith(keyPrefix));
    const unfinished = sameAction.find((row) => UNFINISHED.includes(row.status));
    if (unfinished) {
      return {
        recoveryActionId: unfinished.id,
        status: unfinished.status,
        blockedAt: unfinished.blockedAt,
        created: false,
      };
    }
    // After the idempotent lookup: a repeat of an allowed proposal finds the
    // incident already awaiting approval, and must get the proposal back.
    if (scope.status !== startingState(options.investigationId !== undefined)) {
      throw new ProposalConflictError(incidentId);
    }

    const now = new Date();
    const result = evaluatePolicy(request, await gatherFacts(tx, request, scope, now), PROPOSAL_STEPS);
    span.setAttribute('labops.policy.allowed', result.allowed);
    const action = await tx.recoveryAction.create({
      data: {
        incidentId,
        investigationId: options.investigationId,
        actionType: request.actionType,
        targetIds: request.targetIds,
        parameters: request.parameters as Prisma.InputJsonObject,
        status: result.allowed ? 'awaiting_approval' : 'rejected_by_policy',
        // The attempt number gives a retry after a failure its own key.
        idempotencyKey: `${keyPrefix}${sameAction.length + 1}`,
        proposedBy: actor.id,
        policyDecisions: result.decisions as unknown as Prisma.InputJsonArray,
        blockedAt: result.blockedAt,
        expiresAt: result.allowed ? new Date(now.getTime() + options.approvalTtlMs) : null,
      },
      select: { id: true, status: true },
    });

    // Allowed waits for a human; blocked from a fresh diagnosis means no safe
    // action exists (ARCHITECTURE §7). Blocked in manual review stays there.
    const next = result.allowed ? 'awaiting_approval' : 'manual_review';
    if (scope.status !== next) {
      await transitionIncident(tx, incidentId, next, actor, {
        reason: result.allowed
          ? `${request.actionType} proposed`
          : `${request.actionType} blocked at ${result.blockedAt}`,
      });
    }
    const blocking = result.decisions.find((decision) => !decision.passed);
    await writeAudit(tx, {
      actor,
      action: 'recovery.proposed',
      targetType: 'recovery_action',
      targetId: action.id,
      outcome: action.status,
      metadata: {
        incidentId,
        actionType: request.actionType,
        targets: request.targetIds.length,
        blockedAt: result.blockedAt,
        reason: blocking?.reason,
      },
    });
    return { recoveryActionId: action.id, status: action.status, blockedAt: result.blockedAt, created: true };
  });
}

/**
 * The automatic proposal after a diagnosis, in the investigation's own
 * transaction. The model names labs; a dependency action targets the
 * incident's dependencies instead, read from server-side truth.
 */
export async function proposeRecommendation(
  tx: Prisma.TransactionClient,
  incidentId: string,
  recommendation: { actionType: ActionType; targetLabIds: string[]; investigationId: string },
  actor: Actor,
  approvalTtlMs: number,
): Promise<Proposal> {
  const kind = ACTION_POLICIES[recommendation.actionType].targets;
  const targetIds =
    kind === 'none'
      ? []
      : kind === 'dependencies'
        ? (await lockIncidentScope(tx, incidentId)).dependencyIds
        : recommendation.targetLabIds;
  return proposeAction(
    tx,
    incidentId,
    { actionType: recommendation.actionType, targetIds, parameters: {} },
    actor,
    { approvalTtlMs, investigationId: recommendation.investigationId },
  );
}
