import { describe, expect, it } from 'vitest';
import { ConfigError, GEMINI_BASE_URL, loadConfig } from '../../../../src/platform/config/env.js';

const VALID = {
  DATABASE_URL: 'postgresql://labops:s3cret-pw@localhost:5432/labops',
  REDIS_URL: 'redis://localhost:6379',
};

const GEMINI_KEY = 'test-key-not-a-real-credential';

describe('loadConfig', () => {
  it('applies defaults for optional variables', () => {
    expect(loadConfig(VALID)).toEqual({
      DATABASE_URL: VALID.DATABASE_URL,
      REDIS_URL: VALID.REDIS_URL,
      QUEUE_PREFIX: 'labops',
      API_HOST: '127.0.0.1',
      API_PORT: 4000,
      CORS_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'info',
      DEMO_ENABLED: false,
      SESSION_COOKIE_SECURE: true,
      LLM_PROVIDER: 'fixture',
      LLM_MODEL: 'gemini-3.1-flash-lite',
      LLM_BASE_URL: GEMINI_BASE_URL,
      LLM_TIMEOUT_MS: 30_000,
      LLM_MAX_ATTEMPTS: 3,
      APPROVAL_TTL_MINUTES: 30,
    });
  });

  // The fixture stays selectable without any provider credential.
  it('needs no key for the fixture provider', () => {
    const config = loadConfig(VALID);

    expect(config.LLM_PROVIDER).toBe('fixture');
    expect(config.LLM_API_KEY).toBeUndefined();
  });

  it('accepts the gemini provider with a key', () => {
    const config = loadConfig({ ...VALID, LLM_PROVIDER: 'gemini', LLM_API_KEY: GEMINI_KEY });

    expect(config.LLM_PROVIDER).toBe('gemini');
    expect(config.LLM_API_KEY).toBe(GEMINI_KEY);
  });

  // Negative: a real provider without a key must fail at startup, not on the
  // first incident hours later.
  it('rejects the gemini provider without a key', () => {
    expect(() => loadConfig({ ...VALID, LLM_PROVIDER: 'gemini' })).toThrow(ConfigError);
  });

  it('names LLM_API_KEY as the missing variable', () => {
    try {
      loadConfig({ ...VALID, LLM_PROVIDER: 'gemini' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).problems.join(' ')).toContain('LLM_API_KEY');
    }
  });

  // A key that fails validation must not be echoed back in the startup error.
  it('never includes the key in the error', () => {
    const leaky = '   ';

    try {
      loadConfig({ ...VALID, LLM_PROVIDER: 'gemini', LLM_API_KEY: leaky });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('LLM_API_KEY=   ');
      expect(JSON.stringify(error)).not.toContain('LLM_API_KEY=');
    }
  });

  // The key rides in a request header, so plaintext http to a remote host is
  // not an option; loopback is allowed for a local gateway.
  it.each([
    ['https://gemini.example.com/v1beta'],
    ['http://localhost:8080/v1beta'],
    ['http://127.0.0.1:11434/v1beta'],
  ])('accepts the base url %s', (base) => {
    expect(loadConfig({ ...VALID, LLM_BASE_URL: base }).LLM_BASE_URL).toBe(base);
  });

  it.each([
    ['http://gemini.example.com/v1beta'],
    ['http://10.0.0.5:8080/v1beta'],
    ['ftp://gemini.example.com'],
    ['not a url'],
  ])('rejects the base url %s', (base) => {
    expect(() => loadConfig({ ...VALID, LLM_BASE_URL: base })).toThrow(ConfigError);
  });

  it('coerces LLM_MAX_ATTEMPTS from a string', () => {
    expect(loadConfig({ ...VALID, LLM_MAX_ATTEMPTS: '5' }).LLM_MAX_ATTEMPTS).toBe(5);
  });

  // Negative: a retry count that cannot terminate would hang a job forever.
  it.each([['0'], ['6'], ['abc'], ['-1']])('rejects LLM_MAX_ATTEMPTS=%p', (value) => {
    expect(() => loadConfig({ ...VALID, LLM_MAX_ATTEMPTS: value })).toThrow(ConfigError);
  });

  // Negative: no provider outside the closed enum can ever be selected.
  it.each([['openai'], ['anthropic'], ['Gemini'], [''], ['gemini ']])(
    'rejects the unknown LLM provider %p',
    (provider) => {
      expect(() => loadConfig({ ...VALID, LLM_PROVIDER: provider })).toThrow(ConfigError);
    },
  );

  // Fail-safe: only an explicit 'false' sends the session cookie over http.
  it('keeps the session cookie Secure unless explicitly turned off', () => {
    expect(loadConfig({ ...VALID, SESSION_COOKIE_SECURE: 'false' }).SESSION_COOKIE_SECURE).toBe(
      false,
    );
    expect(() => loadConfig({ ...VALID, SESSION_COOKIE_SECURE: 'maybe' })).toThrow();
  });

  it('parses DEMO_ENABLED as a boolean', () => {
    expect(loadConfig({ ...VALID, DEMO_ENABLED: 'true' }).DEMO_ENABLED).toBe(true);
    expect(loadConfig({ ...VALID, DEMO_ENABLED: 'false' }).DEMO_ENABLED).toBe(false);
  });

  it('coerces the port from a string', () => {
    expect(loadConfig({ ...VALID, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  // Negative cases: each must stop startup rather than run misconfigured.
  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it.each([
    ['DATABASE_URL', 'not a url'],
    ['DATABASE_URL', 'mysql://u:p@localhost/db'],
    ['API_PORT', '0'],
    ['API_PORT', '70000'],
    ['API_PORT', 'abc'],
    ['CORS_ORIGIN', 'javascript:alert(1)'],
    ['LOG_LEVEL', 'verbose'],
    ['DEMO_ENABLED', 'maybe'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['OTEL_EXPORTER_OTLP_ENDPOINT', 'not a url'],
    ['LLM_MODEL', ''],
    ['LLM_MODEL', 'x'.repeat(101)],
  ])('rejects %s=%p', (key, value) => {
    expect(() => loadConfig({ ...VALID, [key]: value })).toThrow(ConfigError);
  });

  it('names every broken variable', () => {
    try {
      loadConfig({ API_PORT: 'abc' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const problems = (error as ConfigError).problems.join(' ');
      expect(problems).toContain('DATABASE_URL');
      expect(problems).toContain('API_PORT');
    }
  });

  // The error is logged at startup, so it must never echo the credential.
  it('never includes the value in the error', () => {
    const leaky = 'mysql://admin:hunter2-secret@db.internal/prod';

    try {
      loadConfig({ DATABASE_URL: leaky });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2-secret');
      expect(JSON.stringify(error)).not.toContain('hunter2-secret');
    }
  });
});
