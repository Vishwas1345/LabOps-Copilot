import { describe, expect, it } from 'vitest';
import { flowSteps } from '@/lib/investigation-flow';
import type { Investigation, RecoveryAction } from '@/lib/schemas';

const investigation = (status: string): Investigation => ({
  id: 'inv-1',
  status,
  outcome: status === 'completed' ? 'diagnosis' : null,
  summary: null,
  candidateCause: null,
  evidenceFor: [],
  evidenceAgainst: [],
  missingEvidence: [],
  diagnosticChecks: [],
  confidence: null,
  recommendedAction: null,
  targetLabIds: [],
  droppedTargets: [],
  failure: status === 'error' ? 'timeout' : null,
  modelMetadata: null,
  createdAt: '2026-10-16T10:00:00.000Z',
  completedAt: null,
});

const action = (status: string, extra: Partial<RecoveryAction> = {}): RecoveryAction => ({
  id: 'act-1',
  actionType: 'RETRY_PROVISIONING',
  targetIds: [],
  status,
  proposedBy: 'worker',
  blockedAt: null,
  policyDecisions: [],
  expiresAt: null,
  approvedBy: null,
  approvedAt: null,
  executedAt: null,
  result: null,
  verificationResult: null,
  createdAt: '2026-10-16T10:00:00.000Z',
  ...extra,
});

const states = (...args: Parameters<typeof flowSteps>) => flowSteps(...args).map((step) => step.state);

describe('flowSteps', () => {
  it('waits at the start before anyone investigates', () => {
    expect(states(undefined, undefined)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
  });

  it('shows the model working while the investigation runs', () => {
    expect(states(investigation('running'), undefined)[0]).toBe('active');
  });

  it('waits for the operator once policy passed', () => {
    expect(states(investigation('completed'), action('awaiting_approval'))).toEqual([
      'done',
      'done',
      'done',
      'active',
      'pending',
    ]);
  });

  it('runs to verified when every lab is ready', () => {
    const succeeded = action('succeeded', { verificationResult: { passed: true } });
    expect(states(investigation('completed'), succeeded)).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  // Negative paths: every way the flow stops must read as stopped, never as done.
  it('stops at the model when the call fails, and nothing later runs', () => {
    expect(states(investigation('error'), undefined)).toEqual(['failed', 'failed', 'pending', 'pending', 'pending']);
  });

  it('marks a policy refusal as blocked, naming the step, and skips the rest', () => {
    const steps = flowSteps(investigation('completed'), action('rejected_by_policy', { blockedAt: 'state' }));
    expect(steps.map((step) => step.state)).toEqual(['done', 'done', 'blocked', 'skipped', 'skipped']);
    expect(steps[2]?.detail).toBe('Blocked at the state step');
  });

  it('skips policy and approval when the model recommended nothing', () => {
    expect(states(investigation('completed'), undefined)).toEqual(['done', 'done', 'skipped', 'skipped', 'skipped']);
  });

  it.each(['rejected', 'expired'])('stops at approval when the action was %s', (status) => {
    expect(states(investigation('completed'), action(status)).slice(3)).toEqual(['blocked', 'skipped']);
  });

  it('marks the re-check at execution blocking the action', () => {
    expect(states(investigation('completed'), action('blocked')).slice(3)).toEqual(['done', 'blocked']);
  });

  it('never calls a failed verification done', () => {
    const failed = action('failed', { verificationResult: { passed: false } });
    expect(states(investigation('completed'), failed)[4]).toBe('failed');
  });
});
