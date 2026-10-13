import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
  isLabStatus,
  LAB_STATUSES,
  LAB_TRANSITIONS,
  nextStatuses,
  type LabStatus,
} from './transitions.js';

const ILLEGAL_TRANSITIONS: ReadonlyArray<readonly [LabStatus, LabStatus]> = [
  // A lab must never jump straight to recovering without first having failed -
  // that would bypass the failure the recovery exists to address.
  ['provisioning', 'recovering'],
  ['provisioning', 'stopped'],
  ['ready', 'recovering'],
  ['ready', 'failed'],
  ['failed', 'ready'],
  ['stopped', 'ready'],
  ['recovering', 'stopped'],
  // No self-transitions: a status change that changes nothing is a bug.
  ['provisioning', 'provisioning'],
];

describe('isLabStatus', () => {
  it('accepts every declared status', () => {
    for (const status of LAB_STATUSES) {
      expect(isLabStatus(status)).toBe(true);
    }
  });

  // Negative case: untrusted status strings must not pass as valid states.
  it.each([['unknown'], [''], ['READY'], [null], [undefined], [42], [{}]])(
    'rejects %p',
    (value) => {
      expect(isLabStatus(value)).toBe(false);
    },
  );
});

describe('canTransition', () => {
  it('allows every declared transition', () => {
    for (const from of LAB_STATUSES) {
      for (const to of LAB_TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it.each(ILLEGAL_TRANSITIONS)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('assertTransition', () => {
  it('returns silently for a legal transition', () => {
    expect(() => assertTransition('failed', 'recovering')).not.toThrow();
  });

  it('throws IllegalTransitionError carrying both states', () => {
    expect(() => assertTransition('ready', 'recovering')).toThrow(
      IllegalTransitionError,
    );

    try {
      assertTransition('ready', 'recovering');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const illegal = error as IllegalTransitionError;
      expect(illegal.from).toBe('ready');
      expect(illegal.to).toBe('recovering');
      expect(illegal.message).toContain('ready');
      expect(illegal.message).toContain('recovering');
    }
  });
});

describe('nextStatuses', () => {
  it('returns the declared targets', () => {
    expect(nextStatuses('provisioning')).toEqual(['ready', 'failed']);
    expect(nextStatuses('ready')).toEqual(['stopped']);
  });

  // Every status must have an entry, otherwise a transition would be silently
  // undefined at runtime.
  it('has an entry for every declared status', () => {
    for (const status of LAB_STATUSES) {
      expect(nextStatuses(status)).toBeDefined();
      expect(Array.isArray(nextStatuses(status))).toBe(true);
    }
  });

  it('never lists a status outside the declared set', () => {
    for (const status of LAB_STATUSES) {
      for (const target of nextStatuses(status)) {
        expect(LAB_STATUSES).toContain(target);
      }
    }
  });
});