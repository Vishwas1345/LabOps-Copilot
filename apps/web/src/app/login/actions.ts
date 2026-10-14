'use server';

// Sign-in through the web server (BFF): the API's session token is copied
// into an httpOnly cookie on this origin and never reaches browser code.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiUrl } from '@/lib/api';
import { sessionTokenFrom } from '@/lib/api-client';
import { loginSchema } from '@/lib/schemas';
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/session';

export interface SignInState {
  error: string | null;
}

// One message per outcome, none of which says whether the username exists.
const MESSAGES: Record<number, string> = {
  400: 'Enter a username and a password.',
  401: 'Invalid username or password.',
  429: 'Too many sign-in attempts. Wait a minute and try again.',
};

export async function signIn(_previous: SignInState, form: FormData): Promise<SignInState> {
  const response = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    cache: 'no-store',
  });
  if (!response.ok) {
    return { error: MESSAGES[response.status] ?? 'Sign-in is unavailable right now.' };
  }
  const token = sessionTokenFrom(response.headers.getSetCookie(), SESSION_COOKIE);
  const parsed = loginSchema.safeParse(await response.json());
  if (!token || !parsed.success) return { error: 'Sign-in is unavailable right now.' };

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: '/',
    expires: new Date(parsed.data.data.expiresAt),
  });
  redirect('/');
}
