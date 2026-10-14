// The execute job: revalidate, act, verify. Approval is permission to re-check,
// so policy steps 3-7 re-run against fresh state first; the simulated action
// runs outside any transaction; and only verification, a re-read of every
// incident lab, can resolve the incident (CLAUDE.md 6).

import type { Prisma } from '@prisma/client';
import type pino from 'pino';
import { z } from 'zod';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import type { IncidentScope } from '../incidents/service.js';
import { lockIncidentScope, transitionIncident } from '../incidents/service.js';
import { IllegalIncidentTransitionError } from '../incidents/transitions.js';
import type { JobDefinition } from '../jobs/runner.js';
import type { ErrorCategory } from '../labs/failures.js';
import { simulateRetry } from '../labs/recovery-simulator.js';
import { labStatusesOf, transitionLab } from '../labs/service.js';
import type { LabStatus } from '../labs/transitions.js';
import { withSpan } from '../observability/tracing.js';
import { EXECUTION_STEPS, evaluatePolicy } from '../policies/evaluate.js';
import { lockAction } from './approve.js';
import { gatherPolicyFacts } from './propose.js';

const WORKER: Actor = { type: 'worker', id: 'labops-worker' };

const executePayload = z.object({ recoveryActionId: z.string().min(1).max(64) }).strict();

type Outcome = 'blocked' | 'succeeded' | 'failed' | 'skipped';

async function loadAction(tx: Prisma.TransactionClient, id: string) {
  await lockAction(tx, id);
  return tx.recoveryAction.findUniqueOrThrow({ where: { id } });
}

const snapshot = (statuses: Map<string, LabStatus>) => Object.fromEntries(statuses);

/**
 * Step 1, in one transaction: re-run policy against fresh state. Blocked ends
 * here; allowed marks the action running and the labs recovering. Returns null
 * when the action is already settled, so a replayed job changes nothing.
 */
async function revalidate(
  id: string,
): Promise<{ incidentId: string; scope: IncidentScope; retry: boolean; targetIds: string[] } | null> {
  return prisma.$transaction(async (tx) => {
    const action = await loadAction(tx, id);
    const scope = await lockIncidentScope(tx, action.incidentId);
    const retry = action.actionType === 'RETRY_PROVISIONING';
    const started = { incidentId: action.incidentId, scope, retry, targetIds: action.targetIds };
    // Crashed after starting: resume the (idempotent) simulated action.
    if (action.status === 'running') return started;
    if (action.status !== 'approved') return null;

    const now = new Date();
    const request = {
      actionType: action.actionType,
      targetIds: action.targetIds,
      parameters: action.parameters,
    };
    const facts = await gatherPolicyFacts(tx, request, scope, now, action.id);
    const result = evaluatePolicy(
      request,
      {
        ...facts,
        approval: { approvedBy: action.approvedBy, expiresAt: action.expiresAt },
        alreadyExecuted: action.executedAt !== null,
      },
      EXECUTION_STEPS,
    );
    const before = snapshot(await labStatusesOf(tx, scope.labIds));
    const executionDecisions = result.decisions as unknown as Prisma.InputJsonArray;

    if (!result.allowed) {
      const blocking = result.decisions.find((decision) => !decision.passed);
      await tx.recoveryAction.update({
        where: { id },
        data: { status: 'blocked', blockedAt: result.blockedAt, result: { executionDecisions, before } },
      });
      await transitionIncident(tx, action.incidentId, 'manual_review', WORKER, {
        reason: `execution blocked at ${result.blockedAt}`,
      });
      await writeAudit(tx, {
        actor: WORKER,
        action: 'recovery.blocked',
        targetType: 'recovery_action',
        targetId: id,
        outcome: 'blocked',
        metadata: { incidentId: action.incidentId, blockedAt: result.blockedAt, reason: blocking?.reason },
      });
      return null;
    }

    await tx.recoveryAction.update({
      where: { id },
      data: { status: 'running', executedAt: now, result: { executionDecisions, before } },
    });
    if (retry) {
      for (const labId of action.targetIds) {
        await transitionLab(tx, labId, 'recovering', WORKER, { reason: `recovery action ${id}` });
      }
    }
    await transitionIncident(tx, action.incidentId, 'recovering', WORKER, {
      reason: `${action.actionType} started`,
    });
    await writeAudit(tx, {
      actor: WORKER,
      action: 'recovery.started',
      targetType: 'recovery_action',
      targetId: id,
      outcome: 'running',
      metadata: { incidentId: action.incidentId, actionType: action.actionType },
    });
    return started;
  });
}

/**
 * Step 3, in one transaction: apply the simulated result, then verify by
 * re-reading every lab in the incident. A job finishing is not verification.
 * Exported so the race with exhaustion, which no public path can force, is tested.
 */
export async function applyAndVerify(
  id: string,
  incidentId: string,
  results: Map<string, 'ready' | 'failed'>,
): Promise<'succeeded' | 'failed' | 'skipped'> {
  return withSpan('recovery.verify', () =>
    prisma.$transaction(async (tx) => {
      const action = await loadAction(tx, id);
      // Compare-and-set: a replay or an exhaustion already settled it.
      if (action.status !== 'running') return 'skipped';

      for (const [labId, to] of results) {
        await transitionLab(tx, labId, to, WORKER, { reason: `recovery action ${id}` });
      }
      const scope = await lockIncidentScope(tx, incidentId);
      const after = snapshot(await labStatusesOf(tx, scope.labIds));
      // D1: resolved only when every lab in the incident is ready, not just
      // the targets; in the simulator a lab's stored status is its health.
      const notReady = Object.entries(after).filter(([, status]) => status !== 'ready');
      const passed = notReady.length === 0;
      const status = passed ? 'succeeded' : 'failed';

      await tx.recoveryAction.update({
        where: { id },
        data: {
          status,
          verificationResult: {
            passed,
            after,
            notReady: notReady.map(([labId]) => labId),
            checkedAt: new Date().toISOString(),
          },
        },
      });
      await transitionIncident(tx, incidentId, passed ? 'resolved' : 'manual_review', WORKER, {
        reason: passed ? 'verification passed' : `verification failed: ${notReady.length} lab(s) not ready`,
      });
      await writeAudit(tx, {
        actor: WORKER,
        action: 'recovery.verified',
        targetType: 'recovery_action',
        targetId: id,
        outcome: passed ? 'passed' : 'failed',
        metadata: { incidentId, notReady: notReady.length },
      });
      return status;
    }),
  );
}

async function runExecution(raw: unknown, log: pino.Logger): Promise<{ outcome: Outcome }> {
  const { recoveryActionId } = executePayload.parse(raw);
  const started = await revalidate(recoveryActionId);
  if (!started) {
    const { status } = await prisma.recoveryAction.findUniqueOrThrow({
      where: { id: recoveryActionId },
      select: { status: true },
    });
    log.info({ recoveryActionId, status }, 'execution not started');
    return { outcome: status === 'blocked' ? 'blocked' : 'skipped' };
  }

  // Step 2, outside any transaction: the simulated action. Only a retry
  // changes lab state; a recheck, a validation rerun or an escalation reads
  // and leaves verification to decide.
  const results = new Map<string, 'ready' | 'failed'>();
  if (started.retry) {
    for (const labId of started.targetIds) {
      const category = (started.scope.categoryByLab.get(labId) ?? null) as ErrorCategory | null;
      results.set(labId, simulateRetry(category));
    }
  }

  const outcome = await applyAndVerify(recoveryActionId, started.incidentId, results);
  log.info({ recoveryActionId, incidentId: started.incidentId, outcome }, 'execution finished');
  return { outcome };
}

// Out of retries: the action failed, labs left recovering go back to failed,
// and the incident goes to manual review instead of hanging in recovery.
async function settleExhausted(raw: unknown, tx: Prisma.TransactionClient): Promise<void> {
  const parsed = executePayload.safeParse(raw);
  if (!parsed.success) return;
  const action = await loadAction(tx, parsed.data.recoveryActionId);
  if (action.status !== 'approved' && action.status !== 'running') return;

  await tx.recoveryAction.update({
    where: { id: action.id },
    data: { status: 'failed', verificationResult: { passed: false, reason: 'job exhausted' } },
  });
  const statuses = await labStatusesOf(tx, action.targetIds);
  for (const [labId, status] of statuses) {
    if (status === 'recovering') {
      await transitionLab(tx, labId, 'failed', WORKER, { reason: 'recovery job exhausted' });
    }
  }
  try {
    await transitionIncident(tx, action.incidentId, 'manual_review', WORKER, {
      reason: 'recovery job exhausted its retries',
    });
  } catch (error) {
    if (!(error instanceof IllegalIncidentTransitionError)) throw error;
  }
}

export function createExecuteJob(): JobDefinition {
  return {
    span: 'recovery.execute',
    handle: runExecution,
    onExhausted: settleExhausted,
  };
}
