import { afterEach, describe, expect, it, vi } from 'vitest';

const set = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const { signIn } = await import('@/app/login/actions');

const form = () => {
  const data = new FormData();
  data.set('username', 'operator');
  data.set('password', 'correct horse battery');
  return data;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  set.mockClear();
});

describe('signIn', () => {
  // The API's token becomes an httpOnly cookie on this origin, with its expiry.
  it('copies the API session into an httpOnly cookie and goes home', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    const response = new Response(
      JSON.stringify({ data: { operator: { id: 'op', username: 'operator' }, expiresAt: '2099-01-01T00:00:00.000Z' } }),
      { status: 200, headers: { 'set-cookie': 'labops_session=tok_123; Path=/; HttpOnly' } },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(signIn({ error: null }, form())).rejects.toThrow('NEXT_REDIRECT /');

    expect(set).toHaveBeenCalledWith('labops_session', 'tok_123', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      expires: new Date('2099-01-01T00:00:00.000Z'),
    });
  });

  // Negative: failures set no cookie and never say whether the user exists.
  it.each([
    [401, /Invalid username or password/],
    [429, /Too many sign-in attempts/],
    [400, /Enter a username and a password/],
    [503, /unavailable/],
  ])('shows a plain message for %i and sets no cookie', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));

    const state = await signIn({ error: null }, form());

    expect(state.error).toMatch(message);
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses a 200 without a session cookie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { operator: { id: 'op', username: 'o' }, expiresAt: 'x' } }), {
          status: 200,
        }),
      ),
    );

    expect((await signIn({ error: null }, form())).error).toMatch(/unavailable/);
    expect(set).not.toHaveBeenCalled();
  });
});
