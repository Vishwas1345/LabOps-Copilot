import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApiUrl, fetchHealth, InvalidApiUrlError } from './api-client';

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