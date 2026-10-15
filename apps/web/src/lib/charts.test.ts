import { describe, expect, it } from 'vitest';
import { bucketLabel, colourFor, ranked } from './charts';
import { windowFrom } from './queries';

describe('chart helpers', () => {
  it('gives each category one colour, and an unknown one a neutral colour', () => {
    expect(colourFor('PROVISION_TIMEOUT')).toBe('var(--chart-1)');
    expect(colourFor('SOMETHING_NEW')).toBe('var(--chart-6)');
  });

  it('labels buckets by time, or by date for day-wide buckets', () => {
    expect(bucketLabel('2026-01-15T14:05:00.000Z', 60_000)).toBe('14:05');
    expect(bucketLabel('2026-01-15T00:00:00.000Z', 86_400_000)).toBe('2026-01-15');
  });

  it('ranks non-zero counts, largest first', () => {
    expect(ranked({ a: 0, b: 2, c: 5, d: 2 })).toEqual([['c', 5], ['b', 2], ['d', 2]]);
  });
});

describe('windowFrom', () => {
  it.each(['1h', '24h', '7d'])('accepts %s', (value) => {
    expect(windowFrom(value)).toBe(value);
  });

  // Negative: only known windows reach the API; anything else falls back.
  it.each([undefined, '', '30d', 'constructor', '24h&hours=9999'])('falls back to 24h for %p', (value) => {
    expect(windowFrom(value)).toBe('24h');
  });
});
