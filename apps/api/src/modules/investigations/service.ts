// Requesting and reading investigations. A request moves the incident to
// `investigating` in the same transaction that creates the investigation and
// its job row, so the scope freezes the moment an operator asks.

import { Prisma } from '@prisma/client';
import type { Investigation } from '@prisma/client';
import type { Actor } from '../../platform/audit/audit.js';
import { writeAudit } from '../../platform/audit/audit.js';
import { prisma } from '../../db.js';
import {
  assertIncidentExists,
  ConcurrentIncidentTransitionError,
  incidentTraceparent,
  transitionIncident,
} from '../incidents/service.js';
import { IllegalIncidentTransitionError } from '../incidents/transitions.js';
import { dispatchJob, jobIdForKey, recordJob } from '../../platform/jobs/record.js';
import { logger } from '../../platform/observability/logger.js';
import { currentTraceparent, withSpan, withTraceparent } from '../../platform/observability/tracing.js';

export const investigateJobKey = (investigationId: string) => `investigate-${investigationId}`;

export interface InvestigationRequest {
  investigationId: string;
  jobId: string;
  /** False when an active investigation already existed and was returned. */
  created: boolean;
}

/** The incident is in a state an investigation cannot start from. */
export class InvestigationConflictError extends Error {
  constructor(readonly incidentId: string) {
    super(`incident ${incidentId} cannot be investigated now`);
    this.name = 'InvestigationConflictError';
  }
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

async function activeInvestigation(incidentId: string): Promise<InvestigationRequest | null> {
  const active = await prisma.investigation.findFirst({
    where: { incidentId, status: { in: ['pending', 'running'] } },
    select: { id: true },
  });
  const jobId = active ? await jobIdForKey(investigateJobKey(active.id)) : null;
  return active && jobId ? { investigationId: active.id, jobId, created: false } : null;
}

/**
 * Idempotent while one is active: a repeat or concurrent request returns the
 * running investigation instead of paying for a second model call.
 */
export async function requestInvestigation(
  incidentId: string,
  actor: Actor,
): Promise<InvestigationRequest> {
  // Starts in the incident's own trace, not this request's, so the queued job
  // and everything after it read as one trace with the incident's birth.
  const parent = await incidentTraceparent(prisma, incidentId);
  return withTraceparent(parent, () => withSpan('investigation.queue', async () => {
    try {
      const { request, job } = await prisma.$transaction(async (tx) => {
        await transitionIncident(tx, incidentId, 'investigating', actor, {
          reason: 'investigation requested',
        });
        const investigation = await tx.investigation.create({
          data: { incidentId, requestedBy: actor.id },
          select: { id: true },
        });
        const job = await recordJob(
          tx,
          'investigate',
          investigateJobKey(investigation.id),
          { investigationId: investigation.id },
          currentTraceparent(),
        );
        await writeAudit(tx, {
          actor,
          action: 'investigation.requested',
          targetType: 'investigation',
          targetId: investigation.id,
          outcome: 'queued',
          metadata: { incidentId },
        });
        return { request: { investigationId: investigation.id, jobId: job.id, created: true }, job };
      });
      // The rows are committed either way; a failed send is resent by the reconciler.
      await dispatchJob(job).catch((error: unknown) =>
        logger.warn({ err: error, jobId: job.id }, 'dispatch failed; reconciler will retry'),
      );
      return request;
    } catch (error) {
      // Already investigating, lost a race, or the index caught a duplicate:
      // hand back the active investigation if there is one.
      const raced =
        error instanceof IllegalIncidentTransitionError ||
        error instanceof ConcurrentIncidentTransitionError ||
        isUniqueViolation(error);
      if (!raced) throw error;
      const active = await activeInvestigation(incidentId);
      if (active) return active;
      throw new InvestigationConflictError(incidentId);
    }
  }));
}

export interface InvestigationView {
  id: string;
  status: Investigation['status'];
  requestedBy: string;
  outcome: Investigation['outcome'];
  summary: string | null;
  candidateCause: string | null;
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingEvidence: string[];
  diagnosticChecks: string[];
  confidence: number | null;
  recommendedAction: Investigation['recommendedAction'];
  targetLabIds: string[];
  droppedTargets: string[];
  evidenceSummary: Prisma.JsonValue;
  failure: Investigation['failure'];
  modelMetadata: Prisma.JsonValue;
  createdAt: string;
  completedAt: string | null;
}

const MAX_LISTED = 20;

/** Newest first; a missing incident is a 404, not an empty list. */
export async function listInvestigations(incidentId: string): Promise<InvestigationView[]> {
  await assertIncidentExists(incidentId);
  const rows = await prisma.investigation.findMany({
    where: { incidentId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_LISTED,
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    requestedBy: row.requestedBy,
    outcome: row.outcome,
    summary: row.summary,
    candidateCause: row.candidateCause,
    evidenceFor: row.evidenceFor,
    evidenceAgainst: row.evidenceAgainst,
    missingEvidence: row.missingEvidence,
    diagnosticChecks: row.diagnosticChecks,
    confidence: row.confidence,
    recommendedAction: row.recommendedAction,
    targetLabIds: row.targetLabIds,
    droppedTargets: row.droppedTargets,
    evidenceSummary: row.evidenceSummary,
    failure: row.failure,
    modelMetadata: row.modelMetadata,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }));
}
