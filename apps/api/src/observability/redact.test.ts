import { describe, expect, it } from 'vitest';
import { isSecretKey, REDACTED, redactSecrets, redactText } from './redact.js';

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
  ])('redacts %p', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  // Negative: ordinary operational text must survive, or evidence is lost.
  it.each([
    ['tokenCount=5 retries=2'],
    ['secretary assigned'],
    ['VM provisioning timed out pulling the base image'],
  ])('leaves %p alone', (input) => {
    expect(redactText(input)).toBe(input);
  });
});
