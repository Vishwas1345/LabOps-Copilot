// API access helpers with no framework dependency, so they unit-test plainly.
// NEXT_PUBLIC_API_URL holds a URL, never a token. Every response is parsed
// with Zod: a malformed one becomes an error state, never a crash.

import type { z } from 'zod';
import { healthSchema } from './schemas';

export class InvalidApiUrlError extends Error {
  constructor(readonly value: string) {
    super(`NEXT_PUBLIC_API_URL is not a valid absolute http(s) URL`);
    this.name = 'InvalidApiUrlError';
  }
}

const DEFAULT_API_URL = 'http://localhost:4000';

/** Requires an absolute http(s) URL; strips a trailing slash before joining. */
export function buildApiUrl(
  baseUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL,
  path = '',
): string {
  const candidate = (baseUrl ?? DEFAULT_API_URL).trim();

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new InvalidApiUrlError(candidate);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidApiUrlError(candidate);
  }

  const origin = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  const suffix = path.startsWith('/') ? path : `/${path}`;

  return suffix === '/' ? origin : `${origin}${suffix}`;
}

export type HealthResponse = z.infer<typeof healthSchema>;

/** Null, not a throw: an unreachable API degrades the page, it does not crash it. */
export async function fetchHealth(
  baseUrl?: string,
  init?: RequestInit,
): Promise<HealthResponse | null> {
  try {
    const response = await fetch(buildApiUrl(baseUrl, '/health'), {
      cache: 'no-store',
      ...init,
    });

    if (!response.ok) {
      return null;
    }

    const parsed = healthSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string };

/** The API answered 2xx with a body that does not match what this page expects. */
export class MalformedResponseError extends Error {
  constructor(readonly path: string) {
    super(`unexpected response from ${path}`);
    this.name = 'MalformedResponseError';
  }
}

const errorEnvelope = (body: unknown): string => {
  const error = (body as { error?: { code?: unknown } } | null)?.error;
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN';
};

/** Pure: a 2xx body must match `schema`; anything else is a typed failure. */
export function parseApiResponse<T>(
  path: string,
  schema: z.ZodType<T>,
  status: number,
  body: unknown,
): ApiResult<T> {
  if (status < 200 || status >= 300) {
    return { ok: false, status, code: errorEnvelope(body) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new MalformedResponseError(path);
  return { ok: true, data: parsed.data };
}

/** The session token from the API's Set-Cookie headers, or null. */
export function sessionTokenFrom(setCookies: readonly string[], cookieName: string): string | null {
  for (const header of setCookies) {
    const [pair] = header.split(';');
    const separator = pair.indexOf('=');
    if (pair.slice(0, separator).trim() === cookieName) {
      const value = pair.slice(separator + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
