import { describe, expect, it } from 'vitest';
import type { PolicyFacts, PolicyStep, ProposedAction } from './evaluate.js';
import { EXECUTION_STEPS, evaluatePolicy, POLICY_STEPS, PROPOSAL_STEPS } from './evaluate.js';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function facts(change: Partial<PolicyFacts> = {}): PolicyFacts {
  return {
    incidentLabIds: new Set(['lab-1', 'lab-2']),
    incidentDependencyIds: new Set(['dep-1']),
    labs: new Map([
      ['lab-1', { status: 'failed', category: 'PROVISION_TIMEOUT' }],
      ['lab-2', { status: 'failed', category: 'PROVISION_TIMEOUT' }],
    ]),
    busyTargets: new Set(),
    attempts: new Map(),
    approval: { approvedBy: 'op-1', expiresAt: new Date(NOW.getTime() + 60_000) },
    alreadyExecuted: false,
    now: NOW,
    ...change,
  };
}

const retry: ProposedAction = {
  actionType: 'RETRY_PROVISIONING',
  targetIds: ['lab-1', 'lab-2'],
  parameters: {},
};

const all = (action: ProposedAction, f: PolicyFacts) => evaluatePolicy(action, f, POLICY_STEPS);

describe('evaluatePolicy', () => {
  it('allows a valid retry and records a passing decision per step', () => {
    const result = all(retry, facts());

    expect(result).toMatchObject({ allowed: true, blockedAt: null });
    expect(result.decisions.map((d) => d.step)).toEqual([...POLICY_STEPS]);
    expect(result.decisions.every((d) => d.passed)).toBe(true);
  });

  // Each row is a block at exactly one step; the result must name that step
  // and record nothing after it.
  it.each<[string, ProposedAction, Partial<PolicyFacts>, PolicyStep, RegExp]>([
    ['an action outside the allow-list', { ...retry, actionType: 'DELETE_LAB' }, {}, 'structural', /not an allow-listed/],
    ['a free-form parameter', { ...retry, parameters: { command: 'reboot' } }, {}, 'structural', /parameters/],
    ['no targets for a lab action', { ...retry, targetIds: [] }, {}, 'structural', /at least one target/],
    ['targets on an action that takes none', { actionType: 'ESCALATE_MANUAL', targetIds: ['lab-1'], parameters: {} }, {}, 'structural', /takes no targets/],
    ['duplicate targets', { ...retry, targetIds: ['lab-1', 'lab-1'] }, {}, 'structural', /duplicate/],
    ['a target outside the incident', { ...retry, targetIds: ['lab-1', 'lab-999'] }, {}, 'target', /lab-999/],
    ['a dependency outside the incident', { actionType: 'RECHECK_DEPENDENCY', targetIds: ['dep-9'], parameters: {} }, {}, 'target', /dep-9/],
    ['a lab that is not failed', retry, { labs: new Map([['lab-1', { status: 'ready', category: null }], ['lab-2', { status: 'failed', category: 'PROVISION_TIMEOUT' }]]) }, 'state', /lab-1 is ready/],
    ['a retry on a permission failure', retry, { labs: new Map([['lab-1', { status: 'failed', category: 'PERMISSION_DENIED' }], ['lab-2', { status: 'failed', category: 'PROVISION_TIMEOUT' }]]) }, 'state', /cannot fix missing permissions/],
    ['a target in another unfinished action', retry, { busyTargets: new Set(['lab-2']) }, 'concurrency', /lab-2/],
    ['a retry inside the cooldown', retry, { attempts: new Map([['lab-1', [minutesAgo(5)]]]) }, 'rate_limit', /cooldown/],
    ['a fourth attempt in a day', retry, { attempts: new Map([['lab-1', [minutesAgo(600), minutesAgo(300), minutesAgo(60)]]]) }, 'rate_limit', /3 attempts/],
    ['no approval', retry, { approval: undefined }, 'authorisation', /no operator approval/],
    ['an expired approval', retry, { approval: { approvedBy: 'op-1', expiresAt: minutesAgo(1) } }, 'authorisation', /expired/],
    ['an action already executed', retry, { alreadyExecuted: true }, 'idempotency', /already executed/],
  ])('blocks %s at its step', (_label, action, change, step, reason) => {
    const result = all(action, facts(change));
    const index = POLICY_STEPS.indexOf(step);

    expect(result).toMatchObject({ allowed: false, blockedAt: step });
    expect(result.decisions).toHaveLength(index + 1);
    expect(result.decisions.at(-1)).toMatchObject({ step, passed: false, reason: expect.stringMatching(reason) });
  });

  it.each([
    ['a dependency recheck', { actionType: 'RECHECK_DEPENDENCY', targetIds: ['dep-1'], parameters: {} }],
    ['an escalation', { actionType: 'ESCALATE_MANUAL', targetIds: [], parameters: {} }],
    ['a validation rerun on a ready lab', { actionType: 'RERUN_VALIDATION', targetIds: ['lab-1'], parameters: {} }],
  ])('allows %s', (_label, action) => {
    const ready = facts({ labs: new Map([['lab-1', { status: 'ready', category: null }]]) });

    expect(all(action, ready).allowed).toBe(true);
  });

  it('allows a retry once the cooldown has passed and attempts are under the cap', () => {
    const attempts = new Map([['lab-1', [minutesAgo(60 * 30), minutesAgo(30)]]]);

    expect(all(retry, facts({ attempts })).allowed).toBe(true);
  });

  // A proposal is judged before any approval exists; steps 6-7 wait for execution.
  it('runs only steps 1-5 for a proposal', () => {
    const result = evaluatePolicy(retry, facts({ approval: undefined }), PROPOSAL_STEPS);

    expect(result.allowed).toBe(true);
    expect(result.decisions.map((d) => d.step)).toEqual([
      'structural',
      'target',
      'state',
      'concurrency',
      'rate_limit',
    ]);
  });

  it('re-checks state onward at execution, so a changed lab is caught', () => {
    const changed = facts({ labs: new Map([['lab-1', { status: 'ready', category: null }], ['lab-2', { status: 'failed', category: 'PROVISION_TIMEOUT' }]]) });

    expect(EXECUTION_STEPS[0]).toBe('state');
    expect(evaluatePolicy(retry, changed, EXECUTION_STEPS).blockedAt).toBe('state');
  });
});
