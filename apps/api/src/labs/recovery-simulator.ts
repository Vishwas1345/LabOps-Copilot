// What a simulated recovery achieves: the stand-in for a real platform call.
// Deterministic, decided by why a lab failed and never by the clock: a retry
// fixes a timeout or an unavailable dependency, but not configuration,
// permissions, quota or validation. Touches no real resource.

import type { ErrorCategory } from './failures.js';

export type RecoveryOutcome = 'recovers' | 'still_failing';

export const RECOVERY_OUTCOMES: Readonly<Record<ErrorCategory, RecoveryOutcome>> = {
  PROVISION_TIMEOUT: 'recovers',
  DEPENDENCY_UNAVAILABLE: 'recovers',
  NETWORK_CONFIG: 'still_failing',
  PERMISSION_DENIED: 'still_failing',
  QUOTA_EXCEEDED: 'still_failing',
  VALIDATION_FAILED: 'still_failing',
};

/** The lab state a simulated retry leaves behind. */
export function simulateRetry(category: ErrorCategory | null): 'ready' | 'failed' {
  return category && RECOVERY_OUTCOMES[category] === 'recovers' ? 'ready' : 'failed';
}
