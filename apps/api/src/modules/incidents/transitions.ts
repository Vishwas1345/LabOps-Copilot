// Legal incident status moves (ARCHITECTURE §7), declared as data so the API,
// worker and tests agree. Same shape as labs/transitions.ts.

import type { IncidentStatus as DbIncidentStatus } from '@prisma/client';

export const INCIDENT_STATUSES = [
  'open',
  'investigating',
  'awaiting_approval',
  'recovering',
  'resolved',
  'manual_review',
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// Fails typecheck if this list and the DB enum ever differ.
const _statusesMatchDatabase: [IncidentStatus] extends [DbIncidentStatus]
  ? [DbIncidentStatus] extends [IncidentStatus]
    ? true
    : never
  : never = true;

export const INCIDENT_TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  open: ['investigating'],
  investigating: ['open', 'awaiting_approval', 'manual_review'],
  awaiting_approval: ['open', 'recovering', 'manual_review'],
  // Only verification decides between these two (CLAUDE.md 6).
  recovering: ['resolved', 'manual_review'],
  resolved: [],
  // An operator may re-run analysis, or propose an action that policy allows.
  manual_review: ['investigating', 'awaiting_approval'],
};

export class IllegalIncidentTransitionError extends Error {
  constructor(
    readonly from: IncidentStatus,
    readonly to: IncidentStatus,
  ) {
    super(`illegal incident transition: ${from} -> ${to}`);
    this.name = 'IllegalIncidentTransitionError';
  }
}

export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

/** Throws unless the move is declared above. */
export function assertIncidentTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!canTransitionIncident(from, to)) {
    throw new IllegalIncidentTransitionError(from, to);
  }
}
