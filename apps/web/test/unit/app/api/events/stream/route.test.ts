import { afterEach, describe, expect, it, vi } from 'vitest';

let token: string | undefined = 'tok';
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (token ? { value: token } : undefined) }),
}));

const { GET } = await import('@/app/api/events/stream/route');

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/events/stream', { headers });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  token = 'tok';
});

describe('GET /api/events/stream (relay)', () => {
  it('streams the API feed with the session forwarded server-side', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.internal:4000');
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {}\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request({ 'last-event-id': '12345' }));

    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe('data: {}\n\n');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.internal:4000/api/events/stream');
    expect(init.headers).toEqual({ cookie: 'labops_session=tok', 'last-event-id': '12345' });
  });

  // Negative: no session means no upstream call at all.
  it('refuses without a session', async () => {
    token = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect((await GET(request())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Negative: a crafted resume point is dropped, not forwarded.
  it('drops a malformed Last-Event-ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await GET(request({ 'last-event-id': '42; DROP TABLE x' }));

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ cookie: 'labops_session=tok' });
  });

  it('passes an upstream refusal through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    expect((await GET(request())).status).toBe(401);
  });
});
