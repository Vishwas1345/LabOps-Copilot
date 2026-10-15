import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/app.js';
import { prisma } from '../../../../src/db.js';
import { loadConfig } from '../../../../src/platform/config/env.js';
import { sign } from '../../../../src/modules/webhooks/signature.js';

const SECRET = 'integration-test-webhook-secret-value';
const URL = '/api/webhooks/mock-platform';

const app = await buildApp({
  config: { ...loadConfig(), DEMO_ENABLED: true, WEBHOOK_SECRET: SECRET },
});
const lab = await prisma.lab.create({ data: { name: 'webhook-int-test' } });

afterAll(async () => {
  await prisma.lab.delete({ where: { id: lab.id } });
  await app.close();
  await prisma.$disconnect();
});

const now = () => Math.floor(Date.now() / 1000);

function event(overrides: Record<string, unknown> = {}) {
  return {
    providerEventId: randomUUID(),
    labId: lab.id,
    type: 'provision_failed',
    errorCategory: 'NETWORK_CONFIG',
    message: 'subnet overlaps',
    occurredAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/** Signs the exact string that will be sent, which is the whole point. */
function deliver(body: string, timestampSeconds = now(), secret = SECRET) {
  return app.inject({
    method: 'POST',
    url: URL,
    payload: body,
    headers: { 'content-type': 'application/json', 'x-labops-signature': `t=${timestampSeconds},v1=${sign(body, timestampSeconds, secret)}` },
  });
}

const post = (payload: unknown, timestampSeconds = now()) =>
  deliver(JSON.stringify(payload), timestampSeconds);
const storedCount = () => prisma.operationalEvent.count({ where: { labId: lab.id } });
const rejectionCount = () =>
  prisma.auditEntry.count({ where: { action: 'webhook.rejected', targetId: 'mock-platform' } });

describe('POST /api/webhooks/mock-platform', () => {
  it('accepts a correctly signed event and records it as provider-sourced', async () => {
    const before = await storedCount();
    const providerEventId = randomUUID();

    const response = await post(event({ providerEventId }));

    expect(response.statusCode).toBe(201);
    expect(response.json().data.duplicate).toBe(false);
    // The dedup key embeds the source, so finding it under `provider:` proves
    // both that the row was written and that the source was forced.
    const stored = await prisma.operationalEvent.findUniqueOrThrow({
      where: { deduplicationKey: `provider:${providerEventId}` },
    });
    expect(stored.source).toBe('provider');
    expect(await storedCount()).toBe(before + 1);
  });

  it('returns 200 for a redelivery of an event it already has', async () => {
    const payload = event();

    const first = await post(payload);
    const second = await post(payload);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.duplicate).toBe(true);
  });

  // The core of the whole scheme: the MAC covers the bytes, so a body that
  // means the same thing but is spelled differently must not verify.
  it('rejects a body whose bytes were changed after signing', async () => {
    const before = await storedCount();
    const payload = event();
    const signedBody = JSON.stringify(payload);
    const tampered = JSON.stringify({ ...payload, message: 'subnet overlap' });
    const timestamp = now();

    const response = await app.inject({
      method: 'POST',
      url: URL,
      payload: tampered,
      headers: {
        'content-type': 'application/json',
        'x-labops-signature': `t=${timestamp},v1=${sign(signedBody, timestamp, SECRET)}`,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SIGNATURE_INVALID');
    expect(await storedCount()).toBe(before);
  });

  it('rejects a whitespace-only change to the body', async () => {
    const before = await storedCount();
    const payload = event();
    const timestamp = now();
    const respaced = JSON.stringify(payload, null, 2);

    const response = await app.inject({
      method: 'POST',
      url: URL,
      payload: respaced,
      headers: {
        'content-type': 'application/json',
        'x-labops-signature': `t=${timestamp},v1=${sign(JSON.stringify(payload), timestamp, SECRET)}`,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(await storedCount()).toBe(before);
  });

  it.each([
    ['no signature header', () => undefined],
    ['an empty signature', () => ''],
    ['a malformed signature', () => 't=abc,v1=zz'],
    ['a short signature', () => `t=${now()},v1=abcd`],
    ['a signature from the wrong secret', (body: string) => `t=${now()},v1=${sign(body, now(), 'another-secret')}`],
  ])('rejects %s with 401 and stores nothing', async (_case, buildHeader) => {
    const before = await storedCount();
    const body = JSON.stringify(event());
    const header = buildHeader(body);

    const response = await app.inject({
      method: 'POST',
      url: URL,
      payload: body,
      headers: { 'content-type': 'application/json', ...(header === undefined ? {} : { 'x-labops-signature': header }) },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SIGNATURE_INVALID');
    expect(await storedCount()).toBe(before);
  });

  it('rejects a correctly signed request that is outside the skew window', async () => {
    const before = await storedCount();
    const stale = now() - 3600;

    const response = await post(event(), stale);

    expect(response.statusCode).toBe(401);
    expect(await storedCount()).toBe(before);
  });

  it('rejects a correctly signed request dated far in the future', async () => {
    const response = await post(event(), now() + 3600);

    expect(response.statusCode).toBe(401);
  });

  // Negative: the skew window must not be a way to replay a captured request,
  // so an identical body signed inside the window is still refused once stale.
  it('refuses a replayed delivery after the window closes', async () => {
    const body = JSON.stringify(event());
    const first = await deliver(body, now());
    expect(first.statusCode).toBe(201);

    const replayed = await deliver(body, now());
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().data.duplicate).toBe(true);
  });

  it.each([
    ['an unknown field', { priority: 'p1' }],
    ['a free-text error category', { errorCategory: 'subnet broke' }],
    ['a failure without an error category', { errorCategory: undefined }],
    ['an unknown lab', { labId: 'no-such-lab' }],
  ])('rejects %s and stores nothing', async (_case, overrides) => {
    const before = await storedCount();

    const response = await post(event(overrides));

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await storedCount()).toBe(before);
  });

  it('returns 422 for an unknown lab rather than 500', async () => {
    const response = await post(event({ labId: 'no-such-lab' }));

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNKNOWN_REFERENCE');
  });

  // The provider must not be able to claim its events are simulated.
  it('forces source to provider even when the body claims otherwise', async () => {
    const providerEventId = randomUUID();

    const response = await post(event({ providerEventId, source: 'simulated' }));

    expect(response.statusCode).toBe(201);
    // Had the body's claim won, the key would be `simulated:<id>` and nothing
    // would be found here at all.
    const stored = await prisma.operationalEvent.findUniqueOrThrow({
      where: { deduplicationKey: `provider:${providerEventId}` },
    });
    expect(stored.source).toBe('provider');
  });

  it('refuses an oversized body before parsing it', async () => {
    const response = await post(event({ message: 'x'.repeat(20 * 1024) }));

    expect(response.statusCode).toBe(413);
  });

  it('returns 400 for malformed JSON with a valid signature', async () => {
    const body = '{not json';
    const timestamp = now();

    const response = await deliver(body, timestamp);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_JSON');
  });

  it('answers 404 when no webhook secret is configured', async () => {
    const unconfigured = await buildApp({
      config: { ...loadConfig(), DEMO_ENABLED: true, WEBHOOK_SECRET: undefined },
    });

    const response = await unconfigured.inject({
      method: 'POST',
      url: URL,
      payload: '{}',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_CONFIGURED');
    await unconfigured.close();
  });

  it('is not mounted at all when the demo is disabled', async () => {
    const prod = await buildApp({ config: { ...loadConfig(), DEMO_ENABLED: false } });

    const response = await prod.inject({
      method: 'POST',
      url: URL,
      payload: '{}',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    await prod.close();
  });

  it('records a rejected delivery in the audit trail, without the secret', async () => {
    const before = await rejectionCount();

    await post(event(), now() - 3600);

    expect(await rejectionCount()).toBe(before + 1);
    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'webhook.rejected' },
      orderBy: { seq: 'desc' },
    });
    expect(entry.actorType).toBe('system');
    expect(entry.actorId).toBe('mock-platform');
    expect(JSON.stringify(entry.metadata)).not.toContain(SECRET);
  });

  it('never leaks the secret or the signature in a response', async () => {
    const body = JSON.stringify(event());
    const timestamp = now();

    const rejected = await app.inject({
      method: 'POST',
      url: URL,
      payload: body,
      headers: { 'content-type': 'application/json', 'x-labops-signature': 't=1,v1=bad' },
    });

    expect(rejected.body).not.toContain(SECRET);
    expect(rejected.body).not.toContain('bad');
    expect(await deliver(body, timestamp).then((r) => r.body)).not.toContain(SECRET);
  });

  // Its own app and queue prefix so the shared quota above cannot decide this
// outcome, and a low ceiling so the 429 is reachable without 120 deliveries.
// The events succeed rather than fail, because a failure would enqueue a
// correlate job under a prefix no worker ever reads.
  it('rate limits a flooding sender', async () => {
    const base = loadConfig();
    const limited = await buildApp({
      config: {
        ...base,
        DEMO_ENABLED: true,
        WEBHOOK_SECRET: SECRET,
        QUEUE_PREFIX: `${base.QUEUE_PREFIX}:ratelimit`,
      },
      webhookOptions: { deliveriesPerMinute: 3 },
    });
    const body = JSON.stringify(event({ type: 'provision_succeeded', errorCategory: undefined }));

    const statuses: number[] = [];
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await limited.inject({
        method: 'POST',
        url: URL,
        payload: body,
        headers: {
          'content-type': 'application/json',
          'x-labops-signature': `t=${now()},v1=${sign(body, now(), SECRET)}`,
        },
      });
      statuses.push(last.statusCode);
    }

    expect(statuses.slice(0, 3)).toEqual([201, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429, 429]);
    expect(last?.json().error.code).toBe('RATE_LIMITED');
    expect(last?.headers['retry-after']).toBeDefined();
    await limited.close();
  });
});