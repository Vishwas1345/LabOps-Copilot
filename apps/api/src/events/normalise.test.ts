import { describe, expect, it } from 'vitest';
import type { IncomingEvent } from './schema.js';
import { deduplicationKey, normalise, redactText } from './normalise.js';

const base: IncomingEvent = {
  labId: 'lab-1',
  type: 'provision_failed',
  errorCategory: 'PROVISION_TIMEOUT',
  message: 'timed out',
  occurredAt: '2026-01-15T09:00:00.000Z',
  source: 'provider',
};

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

describe('normalise', () => {
  it('redacts the message and secret-named metadata keys', () => {
    const { event } = normalise({
      ...base,
      message: 'failed with password=hunter2',
      metadata: { region: 'eu', credentials: { key: 'x' }, nested: { apiToken: 'y' } },
    });

    expect(event.message).toBe('failed with password=[redacted]');
    expect(JSON.stringify(event.metadata)).not.toMatch(/hunter2|"x"|"y"/);
    expect(event.metadata).toMatchObject({ region: 'eu' });
  });
});

describe('deduplicationKey', () => {
  it('uses the provider id, scoped by source', () => {
    expect(deduplicationKey({ ...base, providerEventId: 'e1' })).toBe('provider:e1');
    expect(deduplicationKey({ ...base, source: 'simulated', providerEventId: 'e1' })).toBe(
      'simulated:e1',
    );
  });

  it('hashes identity when there is no provider id, stable across calls', () => {
    expect(deduplicationKey(base)).toBe(deduplicationKey({ ...base }));
    expect(deduplicationKey(base)).toMatch(/^hash:[0-9a-f]{64}$/);
  });

  // The message is not identity: a reworded redelivery is still one event.
  it('ignores the message', () => {
    expect(deduplicationKey({ ...base, message: 'other words' })).toBe(deduplicationKey(base));
  });

  it('separates events that differ in identity', () => {
    expect(deduplicationKey({ ...base, occurredAt: '2026-01-15T09:00:01.000Z' })).not.toBe(
      deduplicationKey(base),
    );
  });
});
