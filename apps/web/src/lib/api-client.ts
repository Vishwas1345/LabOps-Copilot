/**
 * Browser-side API access. The browser talks to the API only - never to
 * PostgreSQL, Redis or the LLM (CLAUDE.md 4). `NEXT_PUBLIC_API_URL` holds a URL
 * and nothing else; a token must never reach this module.
 */

export class InvalidApiUrlError extends Error {
  constructor(readonly value: string) {
    super(`NEXT_PUBLIC_API_URL is not a valid absolute http(s) URL`);
    this.name = 'InvalidApiUrlError';
  }
}

const DEFAULT_API_URL = 'http://localhost:4000';

/**
 * Normalises the configured base URL: enforces an absolute http(s) origin and
 * strips a trailing slash so path joining never produces a double slash.
 */
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

export interface HealthResponse {
  service: string;
  status: string;
  checks: { database: string };
}

/**
 * Returns null rather than throwing: an unreachable API is a degraded dashboard,
 * not a crashed page.
 */
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

    return (await response.json()) as HealthResponse;
  } catch {
    return null;
  }
}