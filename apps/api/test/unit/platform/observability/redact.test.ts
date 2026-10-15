import { describe, expect, it } from 'vitest';
import { isSecretKey, REDACTED, redactSecrets, redactText } from '../../../../src/platform/observability/redact.js';

describe('isSecretKey', () => {
  it.each([
    ['token'],
    ['Token'],
    ['TOKEN'],
    ['accessToken'],
    ['refresh_token'],
    ['apiKey'],
    ['api_key'],
    ['x-api-key'],
    ['password'],
    ['clientSecret'],
    ['encryptedCredentials'],
    ['authorization'],
    ['cookie'],
    ['passwordHash'],
    ['tokenHash'],
  ])('treats %p as secret', (key) => {
    expect(isSecretKey(key)).toBe(true);
  });

  // Negative case: suffix matching must not censor ordinary operational fields,
  // or logs lose the data needed to debug an incident.
  it.each([
    ['tokenCount'],
    ['primaryKey'],
    ['keyword'],
    ['passwordPolicyVersion'],
    ['incidentId'],
    ['status'],
  ])('leaves %p alone', (key) => {
    expect(isSecretKey(key)).toBe(false);
  });
});

describe('redactSecrets', () => {
  it('censors a secret at the top level', () => {
    expect(redactSecrets({ token: 's3cret', labId: 'lab-1' })).toEqual({
      token: REDACTED,
      labId: 'lab-1',
    });
  });

  it('censors secrets nested at any depth', () => {
    const input = { a: { b: { c: { password: 's3cret' } } } };
    expect(redactSecrets(input)).toEqual({
      a: { b: { c: { password: REDACTED } } },
    });
  });

  it('censors secrets inside arrays', () => {
    const input = { connections: [{ apiKey: 's3cret', name: 'cloudlabs' }] };
    expect(redactSecrets(input)).toEqual({
      connections: [{ apiKey: REDACTED, name: 'cloudlabs' }],
    });
  });

  it('censors a whole object stored under a secret key', () => {
    expect(redactSecrets({ credentials: { user: 'a', pass: 'b' } })).toEqual({
      credentials: REDACTED,
    });
  });

  it('does not mutate its input', () => {
    const input = { nested: { token: 's3cret' } };
    redactSecrets(input);
    expect(input.nested.token).toBe('s3cret');
  });

  // Class instances are left to Pino's serializers; walking a raw request or
  // an Error here would either be expensive or strip the stack trace.
  it('does not descend into class instances', () => {
    const error = new Error('boom');
    const result = redactSecrets({ err: error });
    expect(result.err).toBe(error);
  });

  it('stops descending past the depth cap instead of recursing forever', () => {
    let deep: Record<string, unknown> = { token: 'too-deep' };
    for (let i = 0; i < 20; i += 1) {
      deep = { next: deep };
    }
    expect(() => redactSecrets(deep)).not.toThrow();
  });
});

describe('redactText', () => {
  it.each([
    ['password=hunter2 rejected', 'password=[redacted] rejected'],
    ['api_key: sk-live-123', 'api_key: [redacted]'],
    ['TOKEN=abc def', 'TOKEN=[redacted] def'],
    ['auth header Bearer eyJhbGciOi.payload.sig', 'auth header Bearer [redacted]'],
    // Secrets recognisable by shape, with no key= in front (found in Phase 7 review).
    ['API key sk-live-4f9a8b7c6d5e4f3a2b1c rejected', 'API key sk-live-[redacted] rejected'],
    ['key sk-proj-AbCdEf0123456789XyZ0 invalid', 'key sk-proj-[redacted] invalid'],
    ['stripe pk_test_51HabcdefGHIJKLmnop', 'stripe pk_test_[redacted]'],
    ['AccessKeyId AKIAIOSFODNN7EXAMPLE denied', 'AccessKeyId AKIA[redacted] denied'],
    ['clone failed: ghp_1234567890abcdefghijABCDEFGHIJ123456', 'clone failed: ghp_[redacted]'],
    [
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ used',
      'github_pat_[redacted] used',
    ],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl expired', 'jwt [redacted] expired'],
    [
      'db postgresql://admin:S3cretPw@db.internal:5432/labs down',
      'db postgresql://admin:[redacted]@db.internal:5432/labs down',
    ],
    ['fetch https://bot:t0k3n@git.example.com/repo.git', 'fetch https://bot:[redacted]@git.example.com/repo.git'],
  ])('redacts %p', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  // Negative: ordinary operational text must survive, or evidence is lost.
  it.each([
    ['tokenCount=5 retries=2'],
    ['secretary assigned'],
    ['VM provisioning timed out pulling the base image'],
    // Look-alikes the shape patterns must not touch.
    ['pip install scikit-learn sk-learn'],
    ['registry http://registry.internal:5000/v2/ unreachable'],
    ['owner alice@example.com notified'],
    ['ghp_short is too short to be a token'],
    ['AKIA prefix alone'],
    ['payload eyJhbGciOiJIUzI1NiJ9 without signature'],
  ])('leaves %p alone', (input) => {
    expect(redactText(input)).toBe(input);
  });
});
