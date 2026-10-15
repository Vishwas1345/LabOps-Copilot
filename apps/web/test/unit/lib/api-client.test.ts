import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  buildApiUrl,
  fetchHealth,
  InvalidApiUrlError,
  MalformedResponseError,
  parseApiResponse,
  sessionTokenFrom,
} from '@/lib/api-client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('buildApiUrl', () => {
  it('joins the base url and path', () => {
    expect(buildApiUrl('http://localhost:4000', '/health')).toBe(
      'http://localhost:4000/health',
    );
  });

  it('adds a leading slash when the path omits one', () => {
    expect(buildApiUrl('http://localhost:4000', 'health')).toBe(
      'http://localhost:4000/health',
    );
  });

  it('does not double the slash when the base has a trailing one', () => {
    expect(buildApiUrl('http://localhost:4000/', '/api/incidents')).toBe(
      'http://localhost:4000/api/incidents',
    );
  });

  it('preserves a base path prefix', () => {
    expect(buildApiUrl('https://ops.example.com/labops/', '/api/labs')).toBe(
      'https://ops.example.com/labops/api/labs',
    );
  });

  // The default must not depend on whatever is in the ambient environment.
  it('defaults to the local development origin when unset', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);

    expect(buildApiUrl(undefined, '/health')).toBe(
      'http://localhost:4000/health',
    );
  });

  // An empty variable is a misconfiguration, not "unset". Falling back to
  // localhost here would silently send production traffic to localhost.
  it('rejects an empty variable rather than defaulting', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');

    expect(() => buildApiUrl(undefined, '/health')).toThrow(InvalidApiUrlError);
  });

  // Negative case: a misconfigured or tampered value must fail loudly rather
  // than silently produce a request to an unexpected origin.
  it.each([
    ['not a url'],
    [''],
    ['   '],
    ['/relative/only'],
    ['ftp://example.com'],
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
  ])('rejects %p', (value) => {
    expect(() => buildApiUrl(value, '/health')).toThrow(InvalidApiUrlError);
  });
});

describe('fetchHealth', () => {
  it('returns the parsed payload on success', async () => {
    const body = {
      service: 'labops-api',
      status: 'ok',
      checks: { database: 'up' },
    };

    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHealth('http://localhost:4000')).resolves.toEqual(body);
  });

  // Negative cases: a degraded dashboard is not a crashed page.
  it('returns null on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );

    await expect(fetchHealth('http://localhost:4000')).resolves.toBeNull();
  });

  it('returns null when the api is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    await expect(fetchHealth('http://localhost:4000')).resolves.toBeNull();
  });
});
describe('fetchHealth parsing', () => {
  // Negative: a 200 with the wrong shape is "unknown", not a crash or a lie.
  it('returns null for a 200 whose body does not match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 42 }))));

    expect(await fetchHealth('http://api.test')).toBeNull();
  });
});

describe('parseApiResponse', () => {
  const schema = z.object({ data: z.object({ id: z.string() }) });

  it('returns the parsed data for a matching 2xx body', () => {
    expect(parseApiResponse('/x', schema, 200, { data: { id: 'a', extra: 1 } })).toEqual({
      ok: true,
      data: { data: { id: 'a' } },
    });
  });

  it('returns the status and error code for a non-2xx', () => {
    expect(parseApiResponse('/x', schema, 409, { error: { code: 'APPROVAL_EXPIRED' } })).toEqual({
      ok: false,
      status: 409,
      code: 'APPROVAL_EXPIRED',
    });
    expect(parseApiResponse('/x', schema, 502, 'Bad Gateway')).toEqual({
      ok: false,
      status: 502,
      code: 'UNKNOWN',
    });
  });

  // Negative: a malformed 2xx must become an error state, never render.
  it.each([
    ['a missing field', { data: {} }],
    ['a wrong type', { data: { id: 7 } }],
    ['no body', null],
  ])('throws MalformedResponseError for %s', (_label, body) => {
    expect(() => parseApiResponse('/x', schema, 200, body)).toThrow(MalformedResponseError);
  });
});

describe('sessionTokenFrom', () => {
  it('reads the named cookie among several', () => {
    const headers = [
      'other=1; Path=/',
      'labops_session=abc_DEF-123; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 2099 00:00:00 GMT',
    ];

    expect(sessionTokenFrom(headers, 'labops_session')).toBe('abc_DEF-123');
  });

  // Negative: a similarly named or cleared cookie is not a session.
  it.each([
    [['labops_session_old=abc; Path=/']],
    [['labops_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']],
    [[]],
  ])('returns null for %j', (headers) => {
    expect(sessionTokenFrom(headers, 'labops_session')).toBeNull();
  });
});
