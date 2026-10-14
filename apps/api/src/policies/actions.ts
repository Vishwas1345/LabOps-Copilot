// The allow-list (ARCHITECTURE §10) as data: what each action targets, when
// a target is eligible, and how often it may run. A Record over ActionType,
// so an action without a policy fails typecheck.

import { z } from 'zod';
import type { ActionType } from '../labs/actions.js';
import type { ErrorCategory } from '../labs/failures.js';
import type { LabStatus } from '../labs/transitions.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface ActionPolicy {
  /** What an action's targetIds name. */
  targets: 'labs' | 'dependencies' | 'none';
  /** No action takes parameters yet; anything sent is rejected, not ignored. */
  parameters: z.ZodType;
  /** Lab states the action may touch; null when it has no lab precondition. */
  eligibleLabStatuses: readonly LabStatus[] | null;
  /** Failure categories this action cannot fix, with the reason shown to operators. */
  blockedCategories: Readonly<Partial<Record<ErrorCategory, string>>>;
  maxAttempts: { count: number; windowMs: number } | null;
  cooldownMs: number | null;
}

const NO_PARAMETERS = z.object({}).strict();

export const ACTION_POLICIES: Readonly<Record<ActionType, ActionPolicy>> = {
  RETRY_PROVISIONING: {
    targets: 'labs',
    parameters: NO_PARAMETERS,
    eligibleLabStatuses: ['failed'],
    blockedCategories: {
      PERMISSION_DENIED: 'a retry cannot fix missing permissions',
    },
    maxAttempts: { count: 3, windowMs: DAY },
    cooldownMs: 10 * MINUTE,
  },
  // Read-only, so always safe; the cooldown only stops repeated checks.
  RECHECK_DEPENDENCY: {
    targets: 'dependencies',
    parameters: NO_PARAMETERS,
    eligibleLabStatuses: null,
    blockedCategories: {},
    maxAttempts: null,
    cooldownMs: 5 * MINUTE,
  },
  RERUN_VALIDATION: {
    targets: 'labs',
    parameters: NO_PARAMETERS,
    eligibleLabStatuses: ['failed', 'ready'],
    blockedCategories: {},
    maxAttempts: { count: 3, windowMs: DAY },
    cooldownMs: null,
  },
  // No side effects; it still goes through approval like every other action.
  ESCALATE_MANUAL: {
    targets: 'none',
    parameters: NO_PARAMETERS,
    eligibleLabStatuses: null,
    blockedCategories: {},
    maxAttempts: null,
    cooldownMs: null,
  },
};
