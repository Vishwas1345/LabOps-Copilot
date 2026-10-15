import { describe, expect, it } from 'vitest';
import { incidentQuery, isId } from '@/lib/queries';
import { sessionCookieSecure } from '@/lib/session';

describe('incidentQuery', () => {
  it('passes known filters through', () => {
    expect(incidentQuery({ status: 'open', severity: 'high', cursor: 'abc123' })).toBe(
      'limit=25&status=open&severity=high&cursor=abc123',
    );
  });

  // Negative: a crafted URL cannot add parameters or odd values to the API call.
  it.each([
    [{ status: 'open&limit=1000' }],
    [{ severity: 'critical' }],
    [{ cursor: '../../admin' }],
  ])('drops %j', (params) => {
    expect(incidentQuery(params)).toBe('limit=25');
  });
});

describe('isId', () => {
  it('accepts ids and rejects anything that could change a path', () => {
    expect(isId('cmv7vvy7b000nvq01z2u9rsnm')).toBe(true);
    expect(isId('../incidents')).toBe(false);
    expect(isId('a'.repeat(65))).toBe(false);
    expect(isId(undefined)).toBe(false);
  });
});

describe('sessionCookieSecure', () => {
  // Fail-safe, like the API: only an explicit 'false' drops Secure.
  it('is secure unless explicitly turned off', () => {
    expect(sessionCookieSecure(undefined)).toBe(true);
    expect(sessionCookieSecure('true')).toBe(true);
    expect(sessionCookieSecure('false')).toBe(false);
  });
});
