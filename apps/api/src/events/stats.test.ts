import { describe, expect, it } from 'vitest';
import { bucketWidth } from './stats.js';

const MINUTE = 60_000;

describe('bucketWidth', () => {
  it.each([
    [0, MINUTE],
    [20 * MINUTE, MINUTE],
    [5 * 60 * MINUTE, 10 * MINUTE],
    [24 * 60 * MINUTE, 60 * MINUTE],
  ])('picks a readable width for a %i ms span', (span, width) => {
    expect(bucketWidth(span)).toBe(width);
  });

  // Negative: however long the span, the chart never gets more than 60 buckets.
  it.each([30 * 24 * 60 * MINUTE, 3 * 365 * 24 * 60 * MINUTE])('caps a %i ms span at 60 buckets', (span) => {
    expect(span / bucketWidth(span)).toBeLessThanOrEqual(60);
  });
});
