import { afterEach, describe, expect, it, vi } from 'vitest';

const remove = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'tok' }), delete: remove }),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { signOut } = await import('@/app/(dashboard)/actions');
const { runDemoScenario } = await import('@/app/(dashboard)/demo-action');
const { decide, investigate } = await import('@/app/(dashboard)/incidents/[id]/actions');

const respond = (status: number, body: unknown = { data: {} }) =>
  vi.fn().mockResolvedValue(new Response(body === null ? null : JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  remove.mockClear();
  redirect.mockClear();
});

describe('signOut', () => {
  // Negative: even if the API is unreachable, the cookie here is dropped.
  it('drops the cookie whatever the API answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    await expect(signOut()).rejects.toThrow('NEXT_REDIRECT /login');
    expect(remove).toHaveBeenCalledWith('labops_session');
  });
});

describe('runDemoScenario', () => {
  it('reports a disabled demo instead of failing', async () => {
    vi.stubGlobal('fetch', respond(404, { error: { code: 'NOT_FOUND' } }));

    await expect(runDemoScenario()).rejects.toThrow('NEXT_REDIRECT /?demo=unavailable');
  });

  it('seeds both scenarios, then returns to the dashboard', async () => {
    // A fresh response per call: a body can be read only once.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(runDemoScenario()).rejects.toThrow(/^NEXT_REDIRECT \/$/);
    expect(fetchMock.mock.calls.map(([url]: unknown[]) => String(url).split('/').pop())).toEqual([
      'training-event',
      'shared-outages',
    ]);
  });

  // Negative: a failed first scenario stops before the second is sent.
  it('stops at the first failure', async () => {
    const fetchMock = respond(404, { error: { code: 'NOT_FOUND' } });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runDemoScenario()).rejects.toThrow('NEXT_REDIRECT /?demo=unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('incident actions', () => {
  it('approves through the API and returns to the incident', async () => {
    const fetchMock = respond(202);
    vi.stubGlobal('fetch', fetchMock);

    await expect(decide('inc1', 'act1', 'approve')).rejects.toThrow('NEXT_REDIRECT /incidents/inc1');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/recovery-actions\/act1\/approve$/);
  });

  it('shows the API code when a decision fails', async () => {
    vi.stubGlobal('fetch', respond(409, { error: { code: 'APPROVAL_EXPIRED' } }));

    await expect(decide('inc1', 'act1', 'approve')).rejects.toThrow(
      'NEXT_REDIRECT /incidents/inc1?notice=APPROVAL_EXPIRED',
    );
  });

  // Negative: a tampered id or decision never reaches the API.
  it.each([
    () => decide('../x', 'act1', 'approve'),
    () => decide('inc1', 'act1/../../admin', 'approve'),
    () => decide('inc1', 'act1', 'delete' as 'approve'),
    () => investigate('inc1?x=1'),
  ])('refuses tampered input (%#)', async (call) => {
    const fetchMock = respond(202);
    vi.stubGlobal('fetch', fetchMock);

    await expect(call()).rejects.toThrow('NEXT_REDIRECT /incidents');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests an investigation', async () => {
    const fetchMock = respond(202);
    vi.stubGlobal('fetch', fetchMock);

    await expect(investigate('inc1')).rejects.toThrow('NEXT_REDIRECT /incidents/inc1');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/incidents\/inc1\/investigate$/);
  });
});
