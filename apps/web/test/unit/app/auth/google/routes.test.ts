// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFlow, newFlow } from '@/lib/google-flow';

let flowCookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (flowCookie ? { value: flowCookie } : undefined) }),
}));

const { GET: start } = await import('@/app/auth/google/start/route');
const { GET: callback } = await import('@/app/auth/google/callback/route');

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';

afterEach(() => {
  vi.unstubAllGlobals();
  flowCookie = undefined;
});

const location = (response: Response) => response.headers.get('location');
const setCookies = (response: Response) => response.headers.getSetCookie().join('\n');

describe('GET /auth/google/start', () => {
  it('stores the flow in an httpOnly cookie and sends the browser to Google', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { url: GOOGLE_URL } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await start(new Request('http://localhost:3000/auth/google/start'));

    expect(location(response)).toBe(GOOGLE_URL);
    expect(setCookies(response)).toMatch(/labops_google_flow=.+; Path=\/auth\/google; .*HttpOnly/i);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(sent).sort()).toEqual(['codeChallenge', 'nonce', 'state']);
    // The verifier itself never leaves this server before the exchange.
    expect(JSON.stringify(sent)).not.toContain('codeVerifier');
  });

  // Negative: whatever the API answers, the browser only goes to Google.
  it('refuses to redirect anywhere but Google', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { url: 'https://evil.example/' } })));

    const response = await start(new Request('http://localhost:3000/auth/google/start'));

    expect(location(response)).toBe('http://localhost:3000/login?error=google_unavailable');
  });
});

describe('GET /auth/google/callback', () => {
  const flow = newFlow();
  const callbackUrl = (params: Record<string, string>) =>
    new Request(`http://localhost:3000/auth/google/callback?${new URLSearchParams(params)}`);

  it('exchanges the code and signs the operator in', async () => {
    flowCookie = encodeFlow(flow);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { data: { operator: { id: 'o1', username: 'ops@example.com' }, expiresAt: '2030-01-01T00:00:00.000Z' } },
        { headers: { 'set-cookie': 'labops_session=tok123; Path=/; HttpOnly' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await callback(callbackUrl({ code: 'c', state: flow.state }));

    expect(location(response)).toBe('http://localhost:3000/');
    expect(setCookies(response)).toContain('labops_session=tok123');
    expect(setCookies(response)).toMatch(/labops_google_flow=;/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      code: 'c',
      codeVerifier: flow.codeVerifier,
      nonce: flow.nonce,
    });
  });

  // Negative: a forged or replayed callback never reaches the API.
  it.each([
    ['a state that does not match', () => encodeFlow(flow), { code: 'c', state: newFlow().state }],
    ['no flow cookie at all', () => undefined, { code: 'c', state: flow.state }],
    ['no code', () => encodeFlow(flow), { state: flow.state }],
  ])('refuses %s', async (_label, cookie, params) => {
    flowCookie = cookie();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await callback(callbackUrl(params as Record<string, string>));

    expect(location(response)).toBe('http://localhost:3000/login?error=google_failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookies(response)).not.toContain('labops_session');
  });

  it('reports a cancelled sign-in and an account not on the allow-list', async () => {
    expect(location(await callback(callbackUrl({ error: 'access_denied' })))).toBe(
      'http://localhost:3000/login?error=google_cancelled',
    );
    flowCookie = encodeFlow(flow);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    expect(location(await callback(callbackUrl({ code: 'c', state: flow.state })))).toBe(
      'http://localhost:3000/login?error=google_not_allowed',
    );
  });
});
