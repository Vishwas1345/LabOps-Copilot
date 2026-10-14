import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (store.has(name) ? { value: store.get(name) } : undefined) }),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

const { apiGet, apiRequest } = await import('./api');

const schema = z.object({ data: z.object({ id: z.string() }) });
const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(body === null ? null : JSON.stringify(body), { status }));

beforeEach(() => {
  store.clear();
  vi.stubEnv('API_INTERNAL_URL', 'http://api.internal:4000');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  redirect.mockClear();
});

describe('apiRequest', () => {
  // The BFF's core: the operator's session goes to the API server-side only.
  it('forwards the session cookie to the internal API URL', async () => {
    store.set('labops_session', 'token-123');
    const fetchMock = respond(200, { data: { id: 'a' } });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiRequest('/api/x', schema, { method: 'POST', body: { a: 1 } });

    expect(result).toEqual({ ok: true, data: { data: { id: 'a' } } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.internal:4000/api/x');
    expect(init.headers).toMatchObject({
      cookie: 'labops_session=token-123',
      'content-type': 'application/json',
    });
    expect(init.cache).toBe('no-store');
  });

  it('sends no cookie header when signed out', async () => {
    const fetchMock = respond(200, { data: { id: 'a' } });
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/x', schema);

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('cookie');
  });

  // Negative: an expired or revoked session sends the operator to login.
  it('redirects to login on a 401', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { code: 'UNAUTHENTICATED' } }));

    await expect(apiRequest('/api/x', schema)).rejects.toThrow('NEXT_REDIRECT /login');
  });

  it('returns other failures for the caller to handle', async () => {
    vi.stubGlobal('fetch', respond(409, { error: { code: 'APPROVAL_EXPIRED' } }));

    expect(await apiRequest('/api/x', schema)).toEqual({
      ok: false,
      status: 409,
      code: 'APPROVAL_EXPIRED',
    });
  });

  it('accepts a 204 with no body', async () => {
    vi.stubGlobal('fetch', respond(204, null));

    expect(await apiRequest('/api/x', z.null())).toEqual({ ok: true, data: null });
  });
});

describe('apiGet', () => {
  it('throws on a non-2xx so the page shows its error state', async () => {
    vi.stubGlobal('fetch', respond(500, { error: { code: 'INTERNAL' } }));

    await expect(apiGet('/api/x', schema)).rejects.toThrow('API 500 INTERNAL');
  });
});
