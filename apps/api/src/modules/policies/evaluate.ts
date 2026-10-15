// The policy evaluator (ARCHITECTURE §10). Pure: it judges a proposed action
// against facts the caller gathered, in a fixed order, and stops at the first
// failing step. Reordering the steps is a behaviour change.

import type { ActionType } from '../labs/actions.js';
import { ACTION_TYPES } from '../labs/actions.js';
import type { ErrorCategory } from '../labs/failures.js';
import type { LabStatus } from '../labs/transitions.js';
import type { ActionPolicy } from './actions.js';
import { ACTION_POLICIES } from './actions.js';

export const POLICY_STEPS = [
  'structural',
  'target',
  'state',
  'concurrency',
  'rate_limit',
  'authorisation',
  'idempotency',
] as const;

export type PolicyStep = (typeof POLICY_STEPS)[number];

// Steps 1-5 judge a proposal; 3-7 run again at execution against fresh state.
export const PROPOSAL_STEPS = POLICY_STEPS.slice(0, 5);
export const EXECUTION_STEPS = POLICY_STEPS.slice(2);

export interface PolicyDecision {
  step: PolicyStep;
  passed: boolean;
  reason: string;
}

/** As requested, before validation: the action type is untrusted text here. */
export interface ProposedAction {
  actionType: string;
  targetIds: readonly string[];
  parameters: unknown;
}

/** Server-side truth, gathered by the caller inside its transaction. */
export interface PolicyFacts {
  incidentLabIds: ReadonlySet<string>;
  incidentDependencyIds: ReadonlySet<string>;
  labs: ReadonlyMap<string, { status: LabStatus; category: ErrorCategory | null }>;
  /** Targets already in an unfinished action. */
  busyTargets: ReadonlySet<string>;
  /** When this action type last ran on each target. */
  attempts: ReadonlyMap<string, readonly Date[]>;
  approval?: { approvedBy: string | null; expiresAt: Date | null };
  alreadyExecuted?: boolean;
  now: Date;
}

export interface PolicyResult {
  allowed: boolean;
  blockedAt: PolicyStep | null;
  decisions: PolicyDecision[];
}

const MAX_TARGETS = 50;

/** A failure reason, or null when the step passes. */
type Check = (
  action: ProposedAction,
  policy: ActionPolicy,
  facts: PolicyFacts,
) => string | null;

const isActionType = (value: string): value is ActionType =>
  (ACTION_TYPES as readonly string[]).includes(value);

const CHECKS: Record<PolicyStep, { check: Check; passed: string }> = {
  structural: {
    passed: 'action is allow-listed and well formed',
    // The action type itself is checked before this runs (see evaluatePolicy).
    check: (action, policy) => {
      if (!policy.parameters.safeParse(action.parameters ?? {}).success) {
        return 'parameters do not match the action schema';
      }
      if (policy.targets === 'none') {
        return action.targetIds.length === 0 ? null : 'this action takes no targets';
      }
      if (action.targetIds.length === 0) return 'at least one target is required';
      if (action.targetIds.length > MAX_TARGETS) return `more than ${MAX_TARGETS} targets`;
      if (new Set(action.targetIds).size !== action.targetIds.length) return 'duplicate targets';
      return null;
    },
  },
  target: {
    passed: 'every target belongs to the incident',
    check: (action, policy, facts) => {
      const known = policy.targets === 'labs' ? facts.incidentLabIds : facts.incidentDependencyIds;
      const outside = action.targetIds.filter((id) => !known.has(id));
      return outside.length > 0 ? `not part of this incident: ${outside.join(', ')}` : null;
    },
  },
  state: {
    passed: 'every target is in an eligible state',
    check: (action, policy, facts) => {
      if (policy.targets !== 'labs') return null;
      for (const id of action.targetIds) {
        const lab = facts.labs.get(id);
        if (!lab) return `lab ${id} not found`;
        if (policy.eligibleLabStatuses && !policy.eligibleLabStatuses.includes(lab.status)) {
          return `lab ${id} is ${lab.status}, not ${policy.eligibleLabStatuses.join(' or ')}`;
        }
        const blocked = lab.category ? policy.blockedCategories[lab.category] : undefined;
        if (blocked) return `lab ${id} failed with ${lab.category}: ${blocked}`;
      }
      return null;
    },
  },
  concurrency: {
    passed: 'no target is in another unfinished action',
    check: (action, _policy, facts) => {
      const busy = action.targetIds.filter((id) => facts.busyTargets.has(id));
      return busy.length > 0 ? `already in an unfinished action: ${busy.join(', ')}` : null;
    },
  },
  rate_limit: {
    passed: 'within attempt caps and cooldowns',
    check: (action, policy, facts) => {
      const now = facts.now.getTime();
      for (const id of action.targetIds) {
        const times = (facts.attempts.get(id) ?? []).map((t) => t.getTime());
        if (policy.maxAttempts) {
          const { count, windowMs } = policy.maxAttempts;
          if (times.filter((t) => t > now - windowMs).length >= count) {
            return `${id} already had ${count} attempts in the window`;
          }
        }
        const last = Math.max(...times, -Infinity);
        if (policy.cooldownMs && now - last < policy.cooldownMs) {
          return `${id} is in its cooldown`;
        }
      }
      return null;
    },
  },
  authorisation: {
    passed: 'approved by an operator, and the approval is current',
    check: (_action, _policy, facts) => {
      if (!facts.approval?.approvedBy) return 'no operator approval';
      if (!facts.approval.expiresAt || facts.approval.expiresAt <= facts.now) {
        return 'the approval has expired';
      }
      return null;
    },
  },
  idempotency: {
    passed: 'not executed before',
    check: (_action, _policy, facts) =>
      facts.alreadyExecuted ? 'already executed; the prior result stands' : null,
  },
};

export function evaluatePolicy(
  action: ProposedAction,
  facts: PolicyFacts,
  steps: readonly PolicyStep[],
): PolicyResult {
  const decisions: PolicyDecision[] = [];
  // Step 1 must reject an unknown action before any policy is looked up.
  if (!isActionType(action.actionType)) {
    decisions.push({
      step: 'structural',
      passed: false,
      reason: `${action.actionType} is not an allow-listed action`,
    });
    return { allowed: false, blockedAt: 'structural', decisions };
  }
  const policy = ACTION_POLICIES[action.actionType];
  for (const step of steps) {
    const failure = CHECKS[step].check(action, policy, facts);
    decisions.push({ step, passed: failure === null, reason: failure ?? CHECKS[step].passed });
    if (failure !== null) return { allowed: false, blockedAt: step, decisions };
  }
  return { allowed: true, blockedAt: null, decisions };
}
