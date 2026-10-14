import { z } from 'zod';

// Every variable the API reads, validated at startup so bad config fails fast.
// Add a variable only when a module reads it.
const envSchema = z.object({
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
  // Only the deterministic fixture exists until Phase 11 adds a real model.
  LLM_PROVIDER: z.enum(['fixture']).default('fixture'),
  // Enforced by our code, not the provider's: a hung model cannot hold a job.
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

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
