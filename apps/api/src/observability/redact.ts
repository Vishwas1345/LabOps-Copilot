/**
 * Last-line redaction applied to every log object.
 *
 * Pino's `redact` option matches exact, case-sensitive paths, so a token at the
 * top level, two levels deep, or under `accessToken` slipped through. This walk
 * matches on the key name at any depth instead.
 *
 * It is a safety net, not the control: secrets are still stripped where data
 * enters the system (CLAUDE.md 5). Matching is by key suffix rather than
 * substring so `tokenCount` or `primaryKey` are not censored.
 */

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

// Only plain data is walked. Class instances (Fastify's raw request, Error)
// are left to Pino's serializers, which already pick safe fields from them.
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
