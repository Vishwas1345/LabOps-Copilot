// Censors secret-named keys at any depth and casing; Pino's path-based redact
// missed those. Suffix match, so `tokenCount` and `primaryKey` stay visible.

export const REDACTED = '[redacted]';

const SECRET_KEY_SUFFIXES = [
  'token',
  'secret',
  'password',
  'apikey',
  'credential',
  'credentials',
  'authorization',
  'cookie',
  'passwordhash',
  'tokenhash',
] as const;

// Log objects are shallow; the cap only bounds a pathological payload.
const MAX_DEPTH = 6;

export function isSecretKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[_-]/g, '');
  return SECRET_KEY_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}

// Class instances (raw request, Error) are left to Pino's serializers.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, depth + 1));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = isSecretKey(key) ? REDACTED : walk(child, depth + 1);
  }
  return result;
}

/** Returns a copy with every secret-named key censored. Never mutates input. */
export function redactSecrets(
  object: Record<string, unknown>,
): Record<string, unknown> {
  return walk(object, 0) as Record<string, unknown>;
}

// Free text reaches stored events and, since Phase 7, a model's prompt.
// key=value assignments and bearer tokens first, then secrets recognisable by
// shape alone. The prefix stays so an operator can tell what was removed.
// Patterns cannot be complete; fields known to be risky are excluded instead.
const TEXT_SECRETS: ReadonlyArray<[RegExp, string]> = [
  [/\b(password|passwd|secret|token|api[_-]?key|access[_-]?key)(\s*[:=]\s*)\S+/gi, '$1$2[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  // Provider API keys: sk-..., sk-live-..., pk_test_... (16+ characters after).
  [/\b((?:sk|pk|rk)[-_](?:(?:live|test|proj)[-_])?)[A-Za-z0-9]{16,}/g, '$1[redacted]'],
  // AWS access key ids.
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '$1[redacted]'],
  // GitHub classic and fine-grained tokens.
  [/\b(gh[pousr]_)[A-Za-z0-9]{30,}/g, '$1[redacted]'],
  [/\b(github_pat_)[A-Za-z0-9_]{40,}/g, '$1[redacted]'],
  // JWTs: three base64url segments, the first a JSON header ("eyJ").
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]'],
  // Credentials inside a URL: scheme://user:password@host keeps the user.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1[redacted]@'],
];

export function redactText(text: string): string {
  return TEXT_SECRETS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}
