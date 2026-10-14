// The investigate job: evidence -> prompt -> model -> strict parse -> save.
// No transaction is open while the model runs. A model failure is recorded,
// not thrown, so the queue never re-calls the model on its own; only
// infrastructure errors throw and retry.

import type { Prisma } from '@prisma/client';
import type pino from 'pino';
import { z } from 'zod';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import { transitionIncident } from '../incidents/service.js';
import type { IncidentStatus } from '../incidents/transitions.js';
import { IllegalIncidentTransitionError } from '../incidents/transitions.js';
import type { JobDefinition } from '../jobs/runner.js';
import { assembleEvidence } from './evidence.js';
import type { InvestigationOutput } from './output-schema.js';
import { intersectWithIncident, parseOutput } from './output-schema.js';
import { buildPrompt } from './prompt.js';
import type { LlmProvider } from './provider.js';
import { callProvider } from './provider.js';

const WORKER: Actor = { type: 'worker', id: 'labops-worker' };

const investigatePayload = z.object({ investigationId: z.string().min(1).max(64) }).strict();

type Failure = 'TIMEOUT' | 'MALFORMED_OUTPUT' | 'SCHEMA_REJECTED' | 'REFUSED' | 'PROVIDER_ERROR';

type Result =
  | { kind: 'completed'; output: InvestigationOutput; droppedTargets: string[] }
  | { kind: 'failed'; failure: Failure };

/**
 * Where the incident goes next (ARCHITECTURE §7). A diagnosis with an action
 * stays `investigating` for the policy step (Phase 8); nothing executes here.
 */
function nextIncidentStatus(result: Result): IncidentStatus | null {
  if (result.kind === 'failed') return 'open';
  const { outcome, recommendedAction } = result.output;
  if (outcome === 'insufficient_evidence') return 'open';
  if (recommendedAction === null || recommendedAction === 'ESCALATE_MANUAL') return 'manual_review';
  return null;
}

async function finish(
  investigationId: string,
  incidentId: string,
  result: Result,
  metadata: Prisma.InputJsonObject,
  evidenceSummary: Prisma.InputJsonObject,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const data =
      result.kind === 'completed'
        ? {
            status: 'completed' as const,
            ...result.output,
            droppedTargets: result.droppedTargets,
          }
        : { status: 'error' as const, failure: result.failure };
    // Compare-and-set: a retry or an exhaustion that already settled this
    // investigation matches zero rows, and nothing else is written.
    const { count } = await tx.investigation.updateMany({
      where: { id: investigationId, status: { in: ['pending', 'running'] } },
      data: { ...data, evidenceSummary, modelMetadata: metadata, completedAt: new Date() },
    });
    if (count === 0) return false;

    const next = nextIncidentStatus(result);
    if (next) {
      await transitionIncident(tx, incidentId, next, WORKER, {
        reason: result.kind === 'failed' ? `investigation failed: ${result.failure}` : 'investigation done',
      });
    }
    await writeAudit(tx, {
      actor: WORKER,
      action: result.kind === 'completed' ? 'investigation.completed' : 'investigation.failed',
      targetType: 'investigation',
      targetId: investigationId,
      outcome: result.kind === 'completed' ? result.output.outcome : result.failure,
      metadata: {
        incidentId,
        ...(result.kind === 'completed'
          ? {
              recommendedAction: result.output.recommendedAction,
              droppedTargets: result.droppedTargets.length,
            }
          : {}),
      },
    });
    return true;
  });
}

async function runInvestigation(
  provider: LlmProvider,
  timeoutMs: number,
  raw: unknown,
  log: pino.Logger,
): Promise<{ investigationId: string; result: string }> {
  const { investigationId } = investigatePayload.parse(raw);
  const investigation = await prisma.investigation.findUnique({
    where: { id: investigationId },
    select: { status: true, incidentId: true },
  });
  // Already settled (a duplicate delivery, or exhaustion got there first).
  if (!investigation || investigation.status === 'completed' || investigation.status === 'error') {
    return { investigationId, result: 'skipped' };
  }
  const { incidentId } = investigation;
  await prisma.investigation.updateMany({
    where: { id: investigationId, status: 'pending' },
    data: { status: 'running' },
  });

  const { pack, summary, labIds } = await assembleEvidence(incidentId);
  const call = await callProvider(provider, buildPrompt(pack), timeoutMs);
  let result: Result;
  if (!call.ok) {
    result = { kind: 'failed', failure: call.failure };
  } else {
    const parsed = parseOutput(call.raw);
    result = parsed.ok
      ? {
          kind: 'completed',
          ...intersectWithIncident(parsed.output, {
            labIds: new Set(labIds),
            eventIds: new Set(pack.failures.map((f) => f.eventId)),
          }),
        }
      : { kind: 'failed', failure: parsed.failure };
  }

  const metadata = { provider: provider.name, model: provider.model, latencyMs: call.latencyMs };
  const written = await finish(investigationId, incidentId, result, metadata, { ...summary });
  const outcome = result.kind === 'completed' ? result.output.outcome : result.failure;
  log.info({ incidentId, investigationId, outcome, written }, 'investigation finished');
  return { investigationId, result: outcome };
}

// Out of retries for an infrastructure reason: the incident must not stay
// `investigating` forever, so it goes to manual review (ARCHITECTURE §11).
async function settleExhausted(raw: unknown, tx: Prisma.TransactionClient): Promise<void> {
  const parsed = investigatePayload.safeParse(raw);
  if (!parsed.success) return;
  const investigation = await tx.investigation.findUnique({
    where: { id: parsed.data.investigationId },
    select: { incidentId: true },
  });
  const { count } = await tx.investigation.updateMany({
    where: { id: parsed.data.investigationId, status: { in: ['pending', 'running'] } },
    data: { status: 'error', failure: 'JOB_EXHAUSTED', completedAt: new Date() },
  });
  if (!investigation || count === 0) return;
  try {
    await transitionIncident(tx, investigation.incidentId, 'manual_review', WORKER, {
      reason: 'investigation job exhausted its retries',
    });
  } catch (error) {
    // The incident already left `investigating`; there is nothing to settle.
    if (!(error instanceof IllegalIncidentTransitionError)) throw error;
  }
}

/** Built with its provider, so tests inject malformed, slow or refusing ones. */
export function createInvestigateJob(provider: LlmProvider, timeoutMs: number): JobDefinition {
  return {
    span: 'investigation.llm',
    handle: (payload, log) => runInvestigation(provider, timeoutMs, payload, log),
    onExhausted: settleExhausted,
  };
}
