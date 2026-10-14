// Pair scoring: how strongly a failure belongs with a cluster's anchor. Pure
// and deterministic; the LLM never takes part (CLAUDE.md 6).

import type { ErrorCategory } from '../labs/failures.js';

/** A stored failure, with what scoring needs about its lab and dependency. */
export interface FailureEvent {
  id: string;
  labId: string;
  errorCategory: ErrorCategory;
  dependencyId: string | null;
  dependencyKind: string | null;
  labType: string;
  occurredAt: Date;
}

// Weights (ARCHITECTURE §8). Category and dependency are each strong but not
// enough alone; time corroborates a shared cause; lab type only tips the score.
// Preceding-sequence and transition signals wait for labs with event history.
export const SIGNAL_WEIGHTS = {
  errorCategory: 0.3,
  sharedDependency: 0.3,
  temporalProximity: 0.2,
  labType: 0.05,
} as const;

// Joining needs category + dependency + closeness in time (0.30 + 0.30 + at
// least 0.10). Category alone, or with lab type, can never merge failures.
export const JOIN_THRESHOLD = 0.7;

const BURST_MS = 5 * 60_000;
const NEARBY_MS = 15 * 60_000;

export type SignalName = keyof typeof SIGNAL_WEIGHTS;

export interface PairScore {
  score: number;
  signals: Record<SignalName, number>;
  /** Human-readable evidence, shown to operators verbatim. */
  reasons: string[];
}

/** Full weight within a burst, half when nearby, none beyond. */
function temporalFactor(gapMs: number): number {
  if (gapMs <= BURST_MS) return 1;
  if (gapMs <= NEARBY_MS) return 0.5;
  return 0;
}

export function scorePair(anchor: FailureEvent, candidate: FailureEvent): PairScore {
  const gapMs = Math.abs(candidate.occurredAt.getTime() - anchor.occurredAt.getTime());
  const sameDependency =
    anchor.dependencyId !== null && anchor.dependencyId === candidate.dependencyId;

  const signals: Record<SignalName, number> = {
    errorCategory:
      anchor.errorCategory === candidate.errorCategory ? SIGNAL_WEIGHTS.errorCategory : 0,
    sharedDependency: sameDependency ? SIGNAL_WEIGHTS.sharedDependency : 0,
    temporalProximity: SIGNAL_WEIGHTS.temporalProximity * temporalFactor(gapMs),
    labType: anchor.labType === candidate.labType ? SIGNAL_WEIGHTS.labType : 0,
  };

  const reasons = [
    signals.errorCategory > 0
      ? `same category ${candidate.errorCategory}`
      : `different category (${candidate.errorCategory} vs ${anchor.errorCategory})`,
    sameDependency
      ? `same dependency ${candidate.dependencyKind ?? candidate.dependencyId}`
      : 'no shared dependency',
    `${Math.round(gapMs / 60_000)} min from anchor`,
    ...(signals.labType > 0 ? [`same lab type ${candidate.labType}`] : []),
  ];

  // Rounded to two decimals: operators see 0.85, not 0.8500000000000001.
  const raw = Object.values(signals).reduce((sum, value) => sum + value, 0);
  return { score: Math.round(raw * 100) / 100, signals, reasons };
}
