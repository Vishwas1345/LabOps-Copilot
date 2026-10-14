// Server-only API access (it reads the request's cookies). Pages and server
// actions call the API through here with the operator's session forwarded;
// a 401 anywhere sends the operator to the login page.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { z } from 'zod';
import type { ApiResult } from './api-client';
import { buildApiUrl, parseApiResponse } from './api-client';
import { SESSION_COOKIE } from './session';

// Inside the compose network the browser URL points at the web container itself.
const apiUrl = (path: string) =>
  buildApiUrl(process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL, path);

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const response = await fetch(apiUrl(path), {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  const result = parseApiResponse(path, schema, response.status, body);
  if (!result.ok && result.status === 401) redirect('/login');
  return result;
}

/** For pages: anything but success is thrown to the nearest error boundary. */
export async function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const result = await apiRequest(path, schema);
  if (!result.ok) throw new Error(`API ${result.status} ${result.code} for ${path}`);
  return result.data;
}

export { apiUrl };
