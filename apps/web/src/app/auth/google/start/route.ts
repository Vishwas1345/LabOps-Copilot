// Starts Google sign-in: issues state, PKCE and nonce into a short-lived
// httpOnly cookie, asks the API for Google's URL, and sends the browser there.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiUrl } from '@/lib/api';
import {
  codeChallenge,
  encodeFlow,
  FLOW_COOKIE,
  FLOW_MAX_AGE_SECONDS,
  FLOW_PATH,
  newFlow,
} from '@/lib/google-flow';
import { sessionCookieSecure } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Only ever redirect to Google, whatever the API returns.
const authorizationSchema = z.object({
  data: z.object({ url: z.url().refine((url) => url.startsWith('https://accounts.google.com/')) }),
});

export async function GET(request: Request): Promise<Response> {
  const flow = newFlow();
  const response = await fetch(apiUrl('/api/auth/google/authorization-url'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: flow.state, codeChallenge: codeChallenge(flow.codeVerifier), nonce: flow.nonce }),
    cache: 'no-store',
  }).catch(() => null);
  const parsed = response?.ok ? authorizationSchema.safeParse(await response.json()) : null;
  if (!parsed?.success) {
    return NextResponse.redirect(new URL('/login?error=google_unavailable', request.url));
  }

  const redirect = NextResponse.redirect(parsed.data.data.url);
  redirect.cookies.set(FLOW_COOKIE, encodeFlow(flow), {
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: FLOW_PATH,
    maxAge: FLOW_MAX_AGE_SECONDS,
  });
  return redirect;
}
