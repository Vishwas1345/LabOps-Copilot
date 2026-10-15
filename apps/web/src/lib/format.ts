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

/** A measured duration; null (nothing measured yet) -> "—", never "0 ms". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/** Lab states by count, largest first: { a: 'failed', b: 'ready' } -> "1 failed, 1 ready". */
export function summariseStates(states: Record<string, string> | undefined): string {
  const counts = new Map<string, number>();
  for (const state of Object.values(states ?? {})) counts.set(state, (counts.get(state) ?? 0) + 1);
  if (counts.size === 0) return '—';
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([state, count]) => `${count} ${state}`)
    .join(', ');
}

/** Enum or audit action to words: "awaiting_approval", "recovery.verified". */
export function humanise(value: string): string {
  return value.replace(/[_.]/g, ' ').toLowerCase();
}

// Amber means a human should look, blue means the system is working on it,
// green is a good end, red is a failure or a refusal.
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  open: 'warning',
  investigating: 'info',
  awaiting_approval: 'warning',
  recovering: 'info',
  resolved: 'success',
  manual_review: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
  running: 'info',
  pending: 'info',
  approved: 'info',
  succeeded: 'success',
  completed: 'success',
  failed: 'danger',
  error: 'danger',
  blocked: 'danger',
  rejected_by_policy: 'danger',
  expired: 'neutral',
  rejected: 'neutral',
};

export function statusVariant(status: string): BadgeVariant {
  return STATUS_VARIANT[status] ?? 'outline';
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
