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

// key=value or key: value where the key names a secret, plus bearer tokens.
const SECRET_ASSIGNMENT =
  /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key)(\s*[:=]\s*)\S+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactText(text: string): string {
  return text
    .replace(SECRET_ASSIGNMENT, '$1$2[redacted]')
    .replace(BEARER_TOKEN, 'Bearer [redacted]');
}
