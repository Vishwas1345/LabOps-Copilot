import { describe, expect, it } from 'vitest';
import type { IncidentStatus } from './transitions.js';
import {
  assertIncidentTransition,
  canTransitionIncident,
  IllegalIncidentTransitionError,
  INCIDENT_STATUSES,
  INCIDENT_TRANSITIONS,
} from './transitions.js';

// Moves that would skip a safety step; each must stay impossible.
const FORBIDDEN: ReadonlyArray<readonly [IncidentStatus, IncidentStatus]> = [
  // Resolution without recovery and verification.
  ['open', 'resolved'],
  ['investigating', 'resolved'],
  ['awaiting_approval', 'resolved'],
  // Recovery without approval.
  ['open', 'recovering'],
  ['investigating', 'recovering'],
  // A resolved incident is final.
  ['resolved', 'open'],
  ['resolved', 'investigating'],
  // No self-transitions.
  ['open', 'open'],
];

describe('incident transitions', () => {
  it('allows every declared move', () => {
    for (const from of INCIDENT_STATUSES) {
      for (const to of INCIDENT_TRANSITIONS[from]) {
        expect(canTransitionIncident(from, to)).toBe(true);
      }
    }
  });

  it.each(FORBIDDEN)('forbids %s -> %s', (from, to) => {
    expect(canTransitionIncident(from, to)).toBe(false);
    expect(() => assertIncidentTransition(from, to)).toThrow(IllegalIncidentTransitionError);
  });

  it('reaches resolved only from recovering', () => {
    const into = INCIDENT_STATUSES.filter((s) => INCIDENT_TRANSITIONS[s].includes('resolved'));
    expect(into).toEqual(['recovering']);
  });

  it('names both states in the error', () => {
    expect(() => assertIncidentTransition('open', 'resolved')).toThrow(/open -> resolved/);
  });
});
