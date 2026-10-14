import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './env.js';

const VALID = {
  DATABASE_URL: 'postgresql://labops:s3cret-pw@localhost:5432/labops',
};

describe('loadConfig', () => {
  it('applies defaults for optional variables', () => {
    expect(loadConfig(VALID)).toEqual({
      DATABASE_URL: VALID.DATABASE_URL,
      API_HOST: '127.0.0.1',
      API_PORT: 4000,
      CORS_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'info',
    });
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
