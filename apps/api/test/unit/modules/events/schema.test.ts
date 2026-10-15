import { describe, expect, it } from 'vitest';
import { incomingEvent } from '../../../../src/modules/events/schemas.js';

const failed = {
  providerEventId: 'evt-1',
  labId: 'lab-1',
  type: 'provision_failed',
  errorCategory: 'PROVISION_TIMEOUT',
  message: 'timed out',
  occurredAt: '2026-01-15T09:00:00.000Z',
  source: 'simulated',
};

describe('incomingEvent', () => {
  it('accepts a failed event with a category', () => {
    expect(incomingEvent.safeParse(failed).success).toBe(true);
  });

  it('accepts a succeeded event without a category', () => {
    const { errorCategory: _, ...succeeded } = failed;
    expect(
      incomingEvent.safeParse({ ...succeeded, type: 'provision_succeeded' }).success,
    ).toBe(true);
  });

  // Negative cases: each is refused rather than stored.
  it.each([
    ['a failure without a category', { ...failed, errorCategory: undefined }],
    ['a success with a category', { ...failed, type: 'provision_succeeded' }],
    // Free text is never a category; correlation must not match on strings.
    ['a free-text category', { ...failed, errorCategory: 'VM timed out' }],
    ['an unknown event type', { ...failed, type: 'provision_exploded' }],
    ['an unknown field', { ...failed, severity: 'high' }],
    ['a non-ISO timestamp', { ...failed, occurredAt: 'yesterday' }],
    ['a far-future timestamp', { ...failed, occurredAt: '2999-01-01T00:00:00.000Z' }],
    ['an empty message', { ...failed, message: '' }],
    ['an oversized message', { ...failed, message: 'x'.repeat(2001) }],
    ['an unknown source', { ...failed, source: 'cloudlabs-live' }],
    ['a missing lab', { ...failed, labId: undefined }],
  ])('rejects %s', (_case, event) => {
    expect(incomingEvent.safeParse(event).success).toBe(false);
  });
});
