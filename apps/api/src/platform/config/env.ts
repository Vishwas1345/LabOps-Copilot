import { z } from 'zod';

// The fixture is the default and stays the fallback: selecting a real provider
// is always explicit, so no deploy can start calling a paid API by accident.
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Chosen by measurement, not by preference: on a free-tier key the flash models
// returned 503 "high demand" on four consecutive attempts and gemini-2.5-pro is
// closed to new users, while this one answered. Override it rather than trusting
// the default indefinitely - it is the most volatile value in this file.
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

// Every variable the API reads, validated at startup so bad config fails fast.
// Add a variable only when a module reads it.
const envSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    // Namespaces every queue key, so separate runs never share jobs.
    QUEUE_PREFIX: z.string().min(1).max(64).default('labops'),
    // Traces are exported only when a collector is configured.
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGIN: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
    // Off unless explicitly enabled: demo routes must never ship by accident.
    DEMO_ENABLED: z.stringbool().default(false),
    // Secure by default; only local http development turns it off.
    SESSION_COOKIE_SECURE: z.stringbool().default(true),
    LLM_PROVIDER: z.enum(['fixture', 'gemini']).default('fixture'),
    // Never logged, never returned, never written to modelMetadata.
    LLM_API_KEY: unsetIfEmpty(z.string().max(500)),
    LLM_MODEL: z.string().min(1).max(100).default(DEFAULT_GEMINI_MODEL),
    // Overridable so the same code can point at a local or proxied gateway;
    // http is allowed only for loopback, because the key rides in a header.
    LLM_BASE_URL: z
      .url({ protocol: /^https?$/ })
      .default(GEMINI_BASE_URL)
      .refine(isSecureProviderUrl, {
        message: 'must be https, or http on a loopback host',
      }),
    // Enforced by our code, not the provider's: a hung model cannot hold a job.
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    // The free tier returns 503 under load; a single attempt fails often.
    LLM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
    // How long an allowed proposal waits for approval before it expires.
    APPROVAL_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    // AES-256 key for integration credentials. Optional: without it, saving a
    // credential fails by name instead of storing anything in the clear.
    CREDENTIALS_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be base64 of exactly 32 bytes')
      .optional(),
    // Google sign-in: all four or none. The secret stays on the API; the
    // redirect must be https except on loopback, like the LLM base URL.
    GOOGLE_CLIENT_ID: unsetIfEmpty(z.string().max(256)),
    GOOGLE_CLIENT_SECRET: unsetIfEmpty(z.string().max(256)),
    GOOGLE_REDIRECT_URI: unsetIfEmpty(
      z
        .url({ protocol: /^https?$/ })
        .refine(isSecureProviderUrl, { message: 'must be https, or http on a loopback host' }),
    ),
    // Comma-separated exact emails; nobody else may sign in with Google.
    GOOGLE_ALLOWED_EMAILS: unsetIfEmpty(
      z
        .string()
        .transform((value) => value.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
        .pipe(z.array(z.email()).min(1).max(100)),
    ),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  // A real provider without a key fails at startup, not on the first incident
  // at 2am. Reported by variable name only; the value is never echoed.
  .superRefine((config, ctx) => {
    if (config.LLM_PROVIDER === 'gemini' && !config.LLM_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: 'is required when LLM_PROVIDER is gemini',
      });
    }
    // Half a Google configuration fails at startup rather than at sign-in.
    const google = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'GOOGLE_ALLOWED_EMAILS',
    ] as const;
    const set = google.filter((key) => config[key] !== undefined);
    if (set.length > 0 && set.length < google.length) {
      for (const key of google.filter((k) => config[k] === undefined)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'is required when Google sign-in is configured' });
      }
    }
  });

// `--env-file` sets `KEY=` to an empty string; an empty value means unset.
function unsetIfEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Defensive by design: this runs even when the URL check above already failed,
 * so it must never throw. A value it cannot parse is simply not secure.
 */
function isSecureProviderUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || isLoopback(url.hostname);
}

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

// Errors name the variable, never its value: DATABASE_URL carries a password.
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }

  return result.data;
}
