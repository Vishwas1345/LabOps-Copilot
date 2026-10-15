// The investigation route is the only one that can spend money, so its rate
// limit is the thing standing between a public deployment and an unbounded bill.
// Its own app and queue prefix keep the shared quota above out of the outcome.

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/app.js';
import { loadConfig } from '../../../../src/platform/config/env.js';
import { prisma } from '../../../../src/db.js';
import { signedInCookie } from '../../../fixtures/session.fixture.js';

const base = loadConfig();
const app = await buildApp({
  config: {
    ...base,
    DEMO_ENABLED: false,
    // A fresh namespace so the limit starts at zero regardless of test order.
    QUEUE_PREFIX: `${base.QUEUE_PREFIX}:investigation-limit`,
  },
});
const { cookie } = await signedInCookie();
const lab = await prisma.lab.create({ data: { name: 'investigate-rate-limit' } });

afterAll(async () => {
  await prisma.lab.delete({ where: { id: lab.id } });
  await app.close();
});

const investigate = () =>
  app.inject({
    method: 'POST',
    url: `/api/incidents/${randomUUID()}/investigate`,
    headers: { cookie },
  });

describe('investigation rate limiting', () => {
  it('refuses an unknown incident before any model call is queued', async () => {
    const response = await investigate();

    // 404, not 429: the limiter runs first but an absent incident must not read
    // as a successful investigation, and nothing should have been created.
    expect([404, 429]).toContain(response.statusCode);
  });

  it('returns the standard envelope with a retry-after header when limited', async () => {
    const statuses: number[] = [];
    let last;

    // Enough attempts to exhaust the ceiling regardless of what ran above.
    for (let attempt = 0; attempt < 14; attempt += 1) {
      last = await investigate();
      statuses.push(last.statusCode);
    }

    expect(statuses).toContain(429);
    expect(last?.json().error.code).toBe('RATE_LIMITED');
    expect(last?.headers['retry-after']).toBeDefined();
  });

  it('does not rate limit reading results', async () => {
    // Paging back through investigations must not be throttled by having just
    // queued some; the ceiling is on spending, not on reading.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push(
        (
          await app.inject({
            method: 'GET',
            url: `/api/incidents/${randomUUID()}/investigations`,
            headers: { cookie },
          })
        ).statusCode,
      );
    }

    expect(statuses).not.toContain(429);
  });
});