// Correlate job: turns one window's stored failures into incidents. Grouping
// is the pure clustering in clustering.ts; this file loads its input and
// persists the result, with an audit entry per change in the same transaction.

import type { Prisma, Severity } from '@prisma/client';
import type pino from 'pino';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import { CORRELATION_WINDOW_MS, correlatePayload } from '../events/correlation-window.js';
import type { StoredFailure } from '../events/service.js';
import { getFailures, listFailuresBetween } from '../events/service.js';
import { dependencyKindsOf, labTypesOf } from '../labs/service.js';
import type { NewCluster, ScoredMember } from './clustering.js';
import { clusterFailures } from './clustering.js';
import type { FailureEvent } from './scoring.js';
import { JOIN_THRESHOLD, NEARBY_MS, SIGNAL_WEIGHTS } from './scoring.js';

const WORKER: Actor = { type: 'worker', id: 'labops-worker' };

// One correlation at a time, cluster-wide: two windows that overlap would
// otherwise both see the same failure as unassigned and both claim it.
const CORRELATION_LOCK_KEY = 7_316_001n;

export interface CorrelationOutcome {
  considered: number;
  incidentsCreated: number;
  labsJoined: number;
}

export async function handleCorrelate(
  payload: unknown,
  log: pino.Logger,
): Promise<CorrelationOutcome> {
  const { windowStart } = correlatePayload.parse(payload);
  const outcome = await correlateWindow(new Date(windowStart), log);
  log.info({ windowStart, ...outcome }, 'correlation window processed');
  return outcome;
}

/**
 * Idempotent: failures already in an incident are skipped, so a re-run or a
 * retry after a crash creates nothing new. The window is widened by one window
 * before and two after, so a cluster that straddles a boundary still forms.
 */
export function correlateWindow(start: Date, log: pino.Logger): Promise<CorrelationOutcome> {
  const from = new Date(start.getTime() - CORRELATION_WINDOW_MS);
  const to = new Date(start.getTime() + 2 * CORRELATION_WINDOW_MS);

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CORRELATION_LOCK_KEY})`;

      const failures = await unassigned(tx, await listFailuresBetween(tx, from, to));
      const anchors = await openAnchors(tx, from, to);
      const enrich = await enricher(tx, [...failures, ...anchors.map((a) => a.anchor)]);
      const result = clusterFailures(
        failures.map(enrich),
        anchors.map(({ incidentId, anchor }) => ({ incidentId, anchor: enrich(anchor) })),
      );

      for (const join of result.joins) {
        await addLab(tx, join.incidentId, join);
        log.info({ incidentId: join.incidentId, labId: join.event.labId }, 'lab joined incident');
      }
      for (const cluster of result.clusters) {
        const incidentId = await createIncident(tx, cluster);
        log.info({ incidentId, labs: cluster.members.length + 1 }, 'incident created');
      }

      return {
        considered: failures.length,
        incidentsCreated: result.clusters.length,
        labsJoined: result.joins.length,
      };
    },
    { timeout: 30_000 },
  );
}

// Drops failures already recorded in an incident, and failures of labs that
// sit in an unresolved incident: a lab belongs to one live incident at a time.
// Keeps one failure per lab, since a lab appears in an incident once.
async function unassigned(
  tx: Prisma.TransactionClient,
  failures: StoredFailure[],
): Promise<StoredFailure[]> {
  const taken = await tx.incidentLab.findMany({
    where: {
      OR: [
        { eventId: { in: failures.map((f) => f.id) } },
        {
          labId: { in: failures.map((f) => f.labId) },
          incident: { status: { not: 'resolved' } },
        },
      ],
    },
    select: { eventId: true, labId: true, incident: { select: { status: true } } },
  });
  const takenEvents = new Set(taken.map((row) => row.eventId));
  // Only unresolved incidents make a lab busy: an old failure in a resolved
  // incident must not hide the lab's new failure.
  const busyLabs = new Set(
    taken.filter((row) => row.incident.status !== 'resolved').map((row) => row.labId),
  );
  const seenLabs = new Set<string>();

  return failures.filter((failure) => {
    if (takenEvents.has(failure.id) || busyLabs.has(failure.labId)) return false;
    if (seenLabs.has(failure.labId)) return false;
    seenLabs.add(failure.labId);
    return true;
  });
}

// Only incidents still `open` take new labs: once investigation starts, the
// scope an operator reviews and approves must not change underneath them.
// Anchors further than NEARBY_MS from the range cannot reach the threshold.
async function openAnchors(
  tx: Prisma.TransactionClient,
  from: Date,
  to: Date,
): Promise<Array<{ incidentId: string; anchor: StoredFailure }>> {
  const incidents = await tx.incident.findMany({
    where: { status: 'open' },
    select: { id: true, anchorEventId: true },
  });
  const anchors = await getFailures(
    tx,
    incidents.map((incident) => incident.anchorEventId),
  );
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const lower = from.getTime() - NEARBY_MS;
  const upper = to.getTime() + NEARBY_MS;

  return incidents.flatMap((incident) => {
    const anchor = byId.get(incident.anchorEventId);
    if (!anchor) return [];
    const at = anchor.occurredAt.getTime();
    return at >= lower && at < upper ? [{ incidentId: incident.id, anchor }] : [];
  });
}

/** Adds what scoring needs about each failure's lab and dependency. */
async function enricher(
  tx: Prisma.TransactionClient,
  failures: StoredFailure[],
): Promise<(failure: StoredFailure) => FailureEvent> {
  const labTypes = await labTypesOf(tx, [...new Set(failures.map((f) => f.labId))]);
  const dependencyIds = failures.flatMap((f) => (f.dependencyId ? [f.dependencyId] : []));
  const kinds = await dependencyKindsOf(tx, [...new Set(dependencyIds)]);

  return (failure) => ({
    ...failure,
    labType: labTypes.get(failure.labId) ?? 'unknown',
    dependencyKind: failure.dependencyId ? (kinds.get(failure.dependencyId) ?? null) : null,
  });
}

function severityFor(labCount: number): Severity {
  if (labCount >= 10) return 'high';
  if (labCount >= 3) return 'medium';
  return 'low';
}

function titleFor(anchor: FailureEvent): string {
  const target = anchor.dependencyKind ?? anchor.dependencyId ?? `lab ${anchor.labId}`;
  return `${anchor.errorCategory} on ${target}`;
}

function memberRow(member: ScoredMember) {
  return {
    labId: member.event.labId,
    eventId: member.event.id,
    reason: member.score.reasons.join('; '),
    signalScore: member.score.score,
    signals: member.score.signals,
  };
}

// Correlation strength is the weakest member's score, not an average, so one
// borderline lab is never hidden behind strong ones. Null when alone.
function strengthOf(scores: number[]): number | null {
  return scores.length > 0 ? Math.min(...scores) : null;
}

async function createIncident(tx: Prisma.TransactionClient, cluster: NewCluster): Promise<string> {
  const { anchor, members, nearMiss } = cluster;
  const labCount = members.length + 1;
  const summary =
    members.length > 0
      ? `${labCount} labs scored at least ${JOIN_THRESHOLD} against the first failure`
      : `no other failure scored at least ${JOIN_THRESHOLD} against this one`;

  // windowKey is unique among unresolved incidents (partial index), so even a
  // run that bypassed the lock could not create this incident twice.
  const incident = await tx.incident.create({
    data: {
      title: titleFor(anchor),
      severity: severityFor(labCount),
      windowKey: `anchor:${anchor.id}`,
      anchorEventId: anchor.id,
      confidenceScore: strengthOf(members.map((m) => m.score.score)),
      correlationReason: {
        summary,
        anchorEventId: anchor.id,
        threshold: JOIN_THRESHOLD,
        weights: SIGNAL_WEIGHTS,
        nearMiss: nearMiss
          ? {
              anchorEventId: nearMiss.anchorEventId,
              score: nearMiss.score.score,
              reasons: nearMiss.score.reasons,
            }
          : null,
      },
      labs: {
        create: [
          {
            labId: anchor.labId,
            eventId: anchor.id,
            reason: 'anchor: earliest failure of this incident',
            signalScore: null,
            signals: {},
          },
          ...members.map(memberRow),
        ],
      },
    },
    select: { id: true, severity: true },
  });

  await writeAudit(tx, {
    actor: WORKER,
    action: 'incident.created',
    targetType: 'incident',
    targetId: incident.id,
    outcome: 'open',
    metadata: { anchorEventId: anchor.id, labs: labCount, severity: incident.severity },
  });
  return incident.id;
}

async function addLab(
  tx: Prisma.TransactionClient,
  incidentId: string,
  member: ScoredMember,
): Promise<void> {
  await tx.incidentLab.create({ data: { incidentId, ...memberRow(member) } });

  const labs = await tx.incidentLab.findMany({
    where: { incidentId },
    select: { signalScore: true },
  });
  const scores = labs.flatMap((lab) => (lab.signalScore === null ? [] : [lab.signalScore]));
  const severity = severityFor(labs.length);
  await tx.incident.update({
    where: { id: incidentId },
    data: { severity, confidenceScore: strengthOf(scores) },
  });

  await writeAudit(tx, {
    actor: WORKER,
    action: 'incident.lab_added',
    targetType: 'incident',
    targetId: incidentId,
    outcome: 'applied',
    metadata: {
      labId: member.event.labId,
      eventId: member.event.id,
      score: member.score.score,
      labs: labs.length,
      severity,
    },
  });
}
