import { describe, expect, it } from 'vitest';
import { labParams, listLabsQuery, MAX_PAGE_SIZE } from './schemas.js';

describe('listLabsQuery', () => {
  it('defaults the page size', () => {
    expect(listLabsQuery.parse({})).toEqual({ limit: 20 });
  });

  it('coerces limit from the query string', () => {
    expect(listLabsQuery.parse({ limit: '5' }).limit).toBe(5);
  });

  it('accepts every lab status as a filter', () => {
    expect(listLabsQuery.parse({ status: 'failed' }).status).toBe('failed');
  });

  // Negative cases: an unbounded or malformed list request is refused.
  it.each([
    [{ limit: '0' }],
    [{ limit: String(MAX_PAGE_SIZE + 1) }],
    [{ limit: '2.5' }],
    [{ limit: 'all' }],
    [{ status: 'FAILED' }],
    [{ status: 'exploded' }],
    [{ cursor: '' }],
    [{ cursor: 'x'.repeat(65) }],
    // Strict: a typo must not silently return unfiltered results.
    [{ stauts: 'failed' }],
  ])('rejects %j', (query) => {
    expect(listLabsQuery.safeParse(query).success).toBe(false);
  });
});

describe('labParams', () => {
  it('accepts an id', () => {
    expect(labParams.parse({ id: 'lab-1' })).toEqual({ id: 'lab-1' });
  });

  it.each([[{ id: '' }], [{ id: 'x'.repeat(65) }], [{}]])('rejects %j', (params) => {
    expect(labParams.safeParse(params).success).toBe(false);
  });
});
