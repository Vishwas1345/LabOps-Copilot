// Google sends the browser back here. The state must match the one this
// server issued; the API then exchanges the code, verifies who it is, checks
// the allow-list and returns a session, which is copied as password sign-in does.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiUrl } from '@/lib/api';
import { sessionTokenFrom } from '@/lib/api-client';
import { decodeFlow, FLOW_COOKIE, FLOW_PATH, stateMatches } from '@/lib/google-flow';
import { loginSchema } from '@/lib/schemas';
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const flow = decodeFlow((await cookies()).get(FLOW_COOKIE)?.value);
  // The flow values are single use: cleared on every outcome.
  const finish = (location: string) => {
    const response = NextResponse.redirect(new URL(location, request.url));
    response.cookies.set(FLOW_COOKIE, '', { path: FLOW_PATH, maxAge: 0 });
    return response;
  };

  if (url.searchParams.has('error')) return finish('/login?error=google_cancelled');
  const code = url.searchParams.get('code');
  if (!flow || !code || !stateMatches(flow.state, url.searchParams.get('state'))) {
    return finish('/login?error=google_failed');
  }

  const response = await fetch(apiUrl('/api/auth/google'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier: flow.codeVerifier, nonce: flow.nonce }),
    cache: 'no-store',
  }).catch(() => null);
  if (!response) return finish('/login?error=google_unavailable');
  if (response.status === 403) return finish('/login?error=google_not_allowed');

  const token = response.ok ? sessionTokenFrom(response.headers.getSetCookie(), SESSION_COOKIE) : null;
  const parsed = response.ok ? loginSchema.safeParse(await response.json()) : null;
  if (!token || !parsed?.success) return finish('/login?error=google_failed');

  const done = finish('/');
  done.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: '/',
    expires: new Date(parsed.data.data.expiresAt),
  });
  return done;
}
