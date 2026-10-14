// API access for the web app. NEXT_PUBLIC_API_URL holds a URL, never a token.

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

export interface HealthResponse {
  service: string;
  status: string;
  checks: { database: string };
}

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

    return (await response.json()) as HealthResponse;
  } catch {
    return null;
  }
}