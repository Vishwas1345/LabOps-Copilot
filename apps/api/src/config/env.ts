import { z } from 'zod';

/**
 * Every variable the API reads, validated once at startup. A bad value stops
 * the process before it binds a port, rather than surfacing later as a
 * confusing runtime failure.
 *
 * Only variables a module actually reads belong here. REDIS_URL joins when the
 * queue does (Phase 4).
 */
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
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

/**
 * Problems name the variable and the rule it broke, never the value: a
 * malformed DATABASE_URL still carries a password that must not reach a log.
 */
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
