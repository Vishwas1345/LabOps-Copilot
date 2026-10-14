// Incident reads. Correlation (correlate.job.ts) is the only writer so far;
// transitions arrive with investigation and recovery.

import type { Incident, Prisma, Severity } from '@prisma/client';
import { prisma } from '../db.js';
import type { EventView } from '../events/service.js';
import { getEventViews } from '../events/service.js';
import type { ListIncidentsQuery } from './schemas.js';
import type { IncidentStatus } from './transitions.js';

// "Correlation strength", not "confidence": it measures how alike the
// failures are, never how sure anyone is about the cause (ARCHITECTURE §8).
export interface IncidentSummary {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  correlationStrength: number | null;
  labCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface IncidentLabView {
  labId: string;
  eventId: string;
  /** Why the lab is included; shown to operators verbatim. */
  reason: string;
  /** Score against the anchor; null for the anchor itself. */
  signalScore: number | null;
  signals: Prisma.JsonValue;
}

export interface IncidentDetail extends IncidentSummary {
  anchorEventId: string;
  correlationReason: Prisma.JsonValue;
  labs: IncidentLabView[];
  events: EventView[];
}

export class IncidentNotFoundError extends Error {
  constructor(readonly incidentId: string) {
    super(`incident not found: ${incidentId}`);
    this.name = 'IncidentNotFoundError';
  }
}

function toSummary(incident: Incident, labCount: number): IncidentSummary {
  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    severity: incident.severity,
    correlationStrength: incident.confidenceScore,
    labCount,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
  };
}

// Newest first; `id` breaks ties and one extra row signals a next page.
export async function listIncidents(
  query: ListIncidentsQuery,
): Promise<{ items: IncidentSummary[]; nextCursor: string | null }> {
  const rows = await prisma.incident.findMany({
    where: { status: query.status, severity: query.severity },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { _count: { select: { labs: true } } },
  });
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  return {
    items: page.map((row) => toSummary(row, row._count.labs)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function getIncident(incidentId: string): Promise<IncidentDetail> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { labs: { orderBy: [{ signalScore: { sort: 'desc', nulls: 'first' } }, { labId: 'asc' }] } },
  });
  if (!incident) {
    throw new IncidentNotFoundError(incidentId);
  }

  return {
    ...toSummary(incident, incident.labs.length),
    anchorEventId: incident.anchorEventId,
    correlationReason: incident.correlationReason,
    labs: incident.labs.map((lab) => ({
      labId: lab.labId,
      eventId: lab.eventId,
      reason: lab.reason,
      signalScore: lab.signalScore,
      signals: lab.signals,
    })),
    events: await getEventViews(incident.labs.map((lab) => lab.eventId)),
  };
}

/** Throws IncidentNotFoundError, so a missing incident is 404, not an empty list. */
export async function assertIncidentExists(incidentId: string): Promise<void> {
  const found = await prisma.incident.count({ where: { id: incidentId } });
  if (found === 0) {
    throw new IncidentNotFoundError(incidentId);
  }
}
