import { describe, expect, it } from 'vitest';
import {
  summariseStates,
  formatDuration,
  formatConfidence,
  formatDateTime,
  formatScore,
  humanise,
  noticeFor,
  statusVariant,
} from './format';

describe('formatters', () => {
  it('formats times in UTC and degrades to a dash', () => {
    expect(formatDateTime('2026-01-15T10:05:30.000Z')).toBe('2026-01-15 10:05 UTC');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });

  it('shows a score as correlation strength, a dash when there is none', () => {
    expect(formatScore(0.85)).toBe('0.85');
    expect(formatScore(null)).toBe('—');
  });

  // Confidence is the model's own estimate; the label says so.
  it('labels confidence as the model estimate, never as certainty', () => {
    expect(formatConfidence(0.6)).toBe("60% (model's own estimate)");
    expect(formatConfidence(null)).toBe('—');
  });

  it('turns enum values into words', () => {
    expect(humanise('awaiting_approval')).toBe('awaiting approval');
    expect(humanise('RETRY_PROVISIONING')).toBe('retry provisioning');
    expect(humanise('recovery.verified')).toBe('recovery verified');
  });

  it('gives unknown statuses a neutral badge', () => {
    expect(statusVariant('resolved')).toBe('success');
    expect(statusVariant('manual_review')).toBe('destructive');
    expect(statusVariant('something_new')).toBe('outline');
  });
});

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [0, '0 ms'],
    [999, '999 ms'],
    [1500, '1.5 s'],
    [90_000, '1.5 min'],
  ])('%s -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('summariseStates', () => {
  it('counts lab states, largest first', () => {
    expect(summariseStates({ a: 'failed', b: 'ready', c: 'failed' })).toBe('2 failed, 1 ready');
  });

  it('shows a dash when no state was recorded', () => {
    expect(summariseStates(undefined)).toBe('—');
    expect(summariseStates({})).toBe('—');
  });
});

describe('noticeFor', () => {
  it('explains known API codes and falls back for the rest', () => {
    expect(noticeFor('APPROVAL_EXPIRED')).toMatch(/approval window had passed/);
    expect(noticeFor('SOMETHING_ELSE')).toMatch(/could not be completed/);
    expect(noticeFor(undefined)).toBeNull();
  });
});
