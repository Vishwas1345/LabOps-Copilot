'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { emptySchema } from '@/lib/schemas';
import { SESSION_COOKIE } from '@/lib/session';

// Revokes the session on the API (not just here), then drops the cookie.
export async function signOut(): Promise<void> {
  await apiRequest('/api/auth/logout', emptySchema, { method: 'POST' }).catch(() => undefined);
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
