// Display formatting, kept pure so it is unit-tested. Scores are shown as
// correlation strength or confidence, never as certainty.

import type { BadgeVariant } from '@/components/ui/badge';

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** 0.85 -> "0.85"; null (a single-lab incident has none) -> "—". */
export function formatScore(score: number | null): string {
  return score === null ? '—' : score.toFixed(2);
}

export function formatConfidence(confidence: number | null): string {
  return confidence === null ? '—' : `${Math.round(confidence * 100)}% (model's own estimate)`;
}

/** Enum or audit action to words: "awaiting_approval", "recovery.verified". */
export function humanise(value: string): string {
  return value.replace(/[_.]/g, ' ').toLowerCase();
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  open: 'warning',
  investigating: 'secondary',
  awaiting_approval: 'warning',
  recovering: 'secondary',
  resolved: 'success',
  manual_review: 'destructive',
  high: 'destructive',
  medium: 'warning',
  low: 'secondary',
  succeeded: 'success',
  completed: 'success',
  failed: 'destructive',
  error: 'destructive',
  blocked: 'destructive',
  rejected_by_policy: 'destructive',
  expired: 'outline',
  rejected: 'outline',
};

export function statusVariant(status: string): BadgeVariant {
  return STATUS_VARIANT[status] ?? 'outline';
}

const MOVING_INCIDENT = new Set(['investigating', 'recovering']);
const MOVING_WORK = new Set(['pending', 'running', 'approved']);

/** True while a job is still working on the incident, so the page should refresh. */
export function isInFlight(
  incidentStatus: string,
  work: ReadonlyArray<{ status: string }>,
): boolean {
  return MOVING_INCIDENT.has(incidentStatus) || work.some((item) => MOVING_WORK.has(item.status));
}

const NOTICES: Record<string, string> = {
  INCIDENT_NOT_INVESTIGABLE: 'This incident cannot be investigated in its current state.',
  RECOVERY_ACTION_NOT_PENDING: 'That action is no longer waiting for a decision.',
  APPROVAL_EXPIRED: 'The approval window had passed, so the action expired.',
};

/** A failed decision's API code, shown to the operator in plain words. */
export function noticeFor(code: string | undefined): string | null {
  if (!code) return null;
  return NOTICES[code] ?? 'The action could not be completed. Refresh and try again.';
}
