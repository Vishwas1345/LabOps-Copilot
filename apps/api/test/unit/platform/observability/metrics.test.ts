import { describe, expect, it } from 'vitest';
import { countsFor, toDurationSummary } from '../../../../src/platform/observability/metrics.js';

describe('toDurationSummary', () => {
  it('rounds measured percentiles to whole milliseconds', () => {
    expect(toDurationSummary({ samples: 3, p50: 12.4, p95: 99.6 })).toEqual({
      samples: 3,
      p50Ms: 12,
      p95Ms: 100,
    });
  });

  // Negative: nothing measured must read as unknown, never as 0 ms or NaN.
  it.each([
    ['no row', undefined],
    ['null percentiles', { samples: 0, p50: null, p95: null }],
  ])('reports null, not zero, for %s', (_label, row) => {
    expect(toDurationSummary(row)).toEqual({ samples: 0, p50Ms: null, p95Ms: null });
  });
});

describe('countsFor', () => {
  it('fills every known key, so an absent status reads 0', () => {
    expect(countsFor(['a', 'b', 'c'], [{ key: 'b', count: 2 }])).toEqual({ a: 0, b: 2, c: 0 });
  });
});
