// The evidence pack: a fixed, bounded, redacted view of one incident. The
// model never chooses its own context and never sees event metadata, the
// simplest guarantee that a provider payload's secrets stay out of a prompt.

import { prisma } from '../db.js';
import type { IncidentDetail } from '../incidents/service.js';
import { getIncident } from '../incidents/service.js';
import { dependencyKindsOf, labTypesOf } from '../labs/service.js';
import { REDACTED, redactText } from '../observability/redact.js';

// Caps bound prompt size, cost and injection surface per call (ARCHITECTURE §9).
export const MAX_FAILURES = 50;
export const MAX_MESSAGE_CHARS = 500;

export interface EvidenceFailure {
  eventId: string;
  labId: string;
  labType: string;
  category: string | null;
  dependency: string | null;
  occurredAt: string;
  /** Untrusted provider text: redacted and capped, data only. */
  message: string;
  whyInIncident: string;
}

export interface EvidencePack {
  incident: { id: string; title: string; severity: string; correlation: string };
  failures: EvidenceFailure[];
  omittedFailures: number;
}

export interface EvidenceSummary {
  included: number;
  omitted: number;
  truncatedMessages: number;
  redactions: number;
}

const countRedactions = (text: string) => text.split(REDACTED).length - 1;

/** Pure: the anchor first, then oldest first, capped and redacted. */
export function buildEvidencePack(
  incident: IncidentDetail,
  labTypes: ReadonlyMap<string, string>,
  dependencyKinds: ReadonlyMap<string, string>,
): { pack: EvidencePack; summary: EvidenceSummary } {
  const reasonByEvent = new Map(incident.labs.map((lab) => [lab.eventId, lab]));
  const ordered = [...incident.events].sort(
    (a, b) =>
      Number(b.id === incident.anchorEventId) - Number(a.id === incident.anchorEventId) ||
      a.occurredAt.localeCompare(b.occurredAt),
  );
  const kept = ordered.slice(0, MAX_FAILURES);
  let truncatedMessages = 0;
  let redactions = 0;

  const failures = kept.map((event): EvidenceFailure => {
    const redacted = redactText(event.message);
    redactions += countRedactions(redacted) - countRedactions(event.message);
    if (redacted.length > MAX_MESSAGE_CHARS) truncatedMessages += 1;
    const lab = reasonByEvent.get(event.id);
    return {
      eventId: event.id,
      labId: lab?.labId ?? 'unknown',
      labType: (lab && labTypes.get(lab.labId)) ?? 'unknown',
      category: event.errorCategory,
      dependency: event.dependencyId
        ? (dependencyKinds.get(event.dependencyId) ?? event.dependencyId)
        : null,
      occurredAt: event.occurredAt,
      message: redacted.slice(0, MAX_MESSAGE_CHARS),
      whyInIncident: lab?.reason ?? '',
    };
  });

  const reason = incident.correlationReason as { summary?: unknown } | null;
  return {
    pack: {
      incident: {
        id: incident.id,
        title: incident.title,
        severity: incident.severity,
        correlation: typeof reason?.summary === 'string' ? reason.summary : '',
      },
      failures,
      omittedFailures: ordered.length - kept.length,
    },
    summary: {
      included: failures.length,
      omitted: ordered.length - kept.length,
      truncatedMessages,
      redactions,
    },
  };
}

/** The fixed query: only this incident's labs and the failures that put them there. */
export async function assembleEvidence(incidentId: string): Promise<{
  pack: EvidencePack;
  summary: EvidenceSummary;
  labIds: string[];
}> {
  const incident = await getIncident(incidentId);
  const labIds = incident.labs.map((lab) => lab.labId);
  const dependencyIds = incident.events.flatMap((e) => (e.dependencyId ? [e.dependencyId] : []));
  const [labTypes, dependencyKinds] = await Promise.all([
    labTypesOf(prisma, labIds),
    dependencyKindsOf(prisma, [...new Set(dependencyIds)]),
  ]);
  return { ...buildEvidencePack(incident, labTypes, dependencyKinds), labIds };
}
