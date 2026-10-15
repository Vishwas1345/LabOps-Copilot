import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/app.js';
import { loadConfig } from '../../../../src/platform/config/env.js';
import { prisma } from '../../../../src/db.js';
import { createLogger } from '../../../../src/platform/observability/logger.js';
import { hashPassword } from '../../../../src/platform/auth/password.js';
import { seedOperator } from '../../../../src/platform/auth/service.js';
import { SESSION_COOKIE } from '../../../../src/platform/auth/session.js';
import { signedInCookie } from '../../../fixtures/session.fixture.js';

const lines: string[] = [];
const app = await buildApp({
  // Pinned, not inherited: a local .env may turn Secure off for http development.
  config: { ...loadConfig(), DEMO_ENABLED: true, SESSION_COOKIE_SECURE: true },
  logger: createLogger({ write: (line: string) => lines.push(line) }, 'info'),
});
const PASSWORD = 'correct horse battery staple';
const operator = await prisma.operator.create({
  data: { username: `auth-test-${randomUUID()}`, passwordHash: await hashPassword(PASSWORD) },
});

afterAll(async () => {
  await prisma.operator.delete({ where: { id: operator.id } });
  await app.close();
  await prisma.$disconnect();
});

// The rate limit is per IP, so each test signs in from its own address.
const login = (body: object, remoteAddress = `10.0.0.${Math.floor(Math.random() * 250) + 1}`) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: body, remoteAddress });

const cookieFrom = (response: Awaited<ReturnType<typeof login>>) => {
  const session = response.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
  return { session, header: `${SESSION_COOKIE}=${session?.value ?? ''}` };
};

const me = (cookie?: string) =>
  app.inject({ method: 'GET', url: '/api/auth/me', headers: cookie ? { cookie } : {} });

/** Every registered method + path, rebuilt from Fastify's route tree. */
function registeredRoutes(): Array<{ method: string; url: string }> {
  const stack: string[] = [];
  const routes: Array<{ method: string; url: string }> = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^([│ ]*)[├└]── (\S+) \(([^)]+)\)/.exec(line);
    if (!match) continue;
    const depth = match[1].length / 4;
    stack.length = depth;
    stack.push(match[2]);
    for (const method of match[3].split(', ')) {
      routes.push({ method, url: stack.join('') });
    }
  }
  return routes;
}

describe('route protection', () => {
  const PUBLIC = new Set([
    'GET /health',
    'HEAD /health',
    'POST /api/auth/login',
    'POST /api/demo/scenarios/:name',
    'OPTIONS *',
  ]);

  // Deny by default: a route added later without opting out is covered here.
  it('rejects every non-public route without a session', async () => {
    const routes = registeredRoutes().filter((r) => !PUBLIC.has(`${r.method} ${r.url}`));
    expect(routes.length).toBeGreaterThanOrEqual(10);

    for (const { method, url } of routes) {
      const response = await app.inject({
        method: method as 'GET',
        url: url.replace(/:\w+/g, 'x'),
      });
      expect({ method, url, status: response.statusCode }).toEqual({ method, url, status: 401 });
    }
  });

  it('keeps health and CORS preflight public', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/labs',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(preflight.statusCode).toBe(204);
  });

  it('still returns 404 for a route that does not exist', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(404);
  });
});

describe('POST /api/auth/login', () => {
  it('sets an httpOnly, SameSite=Lax, Secure session cookie and never returns the hash', async () => {
    const response = await login({ username: operator.username, password: PASSWORD });

    expect(response.statusCode).toBe(200);
    const { session, header } = cookieFrom(response);
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: true, path: '/' });
    expect(response.body).not.toContain(operator.passwordHash);
    expect(response.json().data.operator).toEqual({ id: operator.id, username: operator.username });
    expect((await me(header)).json().data).toEqual({ id: operator.id, username: operator.username });
  });

  // Negative: the response must not say whether the username exists.
  it('answers a wrong password and an unknown user identically', async () => {
    const wrong = await login({ username: operator.username, password: 'wrong password' });
    const unknown = await login({ username: `nobody-${randomUUID()}`, password: PASSWORD });

    expect(wrong.statusCode).toBe(401);
    const strip = (body: { error: { requestId: string } }) => ({ ...body.error, requestId: '' });
    expect(strip(unknown.json())).toEqual(strip(wrong.json()));
    expect(cookieFrom(wrong).session).toBeUndefined();
  });

  it('audits failed and successful sign-ins against the operator id', async () => {
    await login({ username: operator.username, password: 'wrong password' });
    await login({ username: operator.username, password: PASSWORD });

    const entries = await prisma.auditEntry.findMany({
      where: { action: 'auth.login', targetId: operator.id },
    });
    expect(entries.map((entry) => entry.outcome)).toEqual(
      expect.arrayContaining(['rejected', 'succeeded']),
    );
  });

  // Negative: a password typed into the username field must not be stored in
  // the append-only audit table.
  it('never records a typed username that matches no operator', async () => {
    const typed = `looks-like-a-password-${randomUUID()}`;

    await login({ username: typed, password: 'anything' });

    const stored = await prisma.auditEntry.count({ where: { targetId: typed } });
    const anyField = await prisma.$queryRaw<[{ n: number }]>`
      SELECT count(*)::int AS n FROM "AuditEntry" WHERE "AuditEntry"::text LIKE ${`%${typed}%`}`;
    expect(stored).toBe(0);
    expect(anyField[0].n).toBe(0);
  });

  // Negative: the sixth attempt in a minute from one address is refused.
  it('rate limits sign-in attempts per address', async () => {
    const address = `10.1.${Math.floor(Math.random() * 250)}.1`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await login({ username: operator.username, password: 'nope' }, address);
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const limited = await login({ username: operator.username, password: 'nope' }, address);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    expect((await login({ username: operator.username, password: PASSWORD })).statusCode).toBe(200);
  });

  it('rejects unknown fields and oversized passwords', async () => {
    expect((await login({ username: 'a', password: 'b', role: 'admin' })).statusCode).toBe(400);
    expect((await login({ username: 'a', password: 'x'.repeat(257) })).statusCode).toBe(400);
  });

  // Negative: the password, its hash and the session token never reach a log line.
  it('never logs the password, the hash or the token', async () => {
    lines.length = 0;
    const response = await login({ username: operator.username, password: PASSWORD });
    await me(cookieFrom(response).header);

    const logs = lines.join('');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain(operator.passwordHash);
    expect(logs).not.toContain(cookieFrom(response).session?.value);
  });
});

describe('sessions', () => {
  // Negative: the table holds only a hash, so reading it yields no usable token.
  it('stores a hash of the token, never the token itself', async () => {
    const response = await login({ username: operator.username, password: PASSWORD });
    const token = cookieFrom(response).session?.value ?? '';

    expect(token).toHaveLength(43);
    expect(await prisma.operatorSession.findUnique({ where: { id: token } })).toBeNull();
    expect(await prisma.operatorSession.count({ where: { operatorId: operator.id } })).toBeGreaterThan(0);
  });

  // Negative: altering one character of the token makes it worthless.
  it('rejects a tampered or malformed cookie', async () => {
    const { cookie } = await signedInCookie();
    const last = cookie.at(-1) === 'A' ? 'B' : 'A';

    expect((await me(cookie)).statusCode).toBe(200);
    expect((await me(cookie.slice(0, -1) + last)).statusCode).toBe(401);
    expect((await me(`${SESSION_COOKIE}=not-a-token`)).statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    const { cookie, operatorId } = await signedInCookie();
    await prisma.operatorSession.updateMany({
      where: { operatorId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await me(cookie)).statusCode).toBe(401);
  });

  // Negative: logout must revoke server-side, not just clear the browser's copy.
  it('revokes the session on logout', async () => {
    const response = await login({ username: operator.username, password: PASSWORD });
    const { header } = cookieFrom(response);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: header },
    });

    expect(logout.statusCode).toBe(204);
    expect((await me(header)).statusCode).toBe(401);
  });
});

describe('audit actor', () => {
  // The actor comes from the session; the body has no say (strict schema).
  it('records the signed-in operator on a human action', async () => {
    const { cookie, operatorId } = await signedInCookie();
    const lab = await prisma.lab.create({ data: { name: 'auth-actor-test' } });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/events',
        headers: { cookie },
        payload: {
          providerEventId: randomUUID(),
          labId: lab.id,
          type: 'provision_succeeded',
          message: 'ok',
          occurredAt: '2024-06-01T10:00:00.000Z',
          source: 'provider',
        },
      });

      const entry = await prisma.auditEntry.findFirst({
        where: { action: 'event.received', targetId: response.json().data.eventId },
      });
      expect(entry).toMatchObject({ actorType: 'human', actorId: operatorId });
    } finally {
      await prisma.lab.delete({ where: { id: lab.id } });
    }
  });
});

describe('seedOperator', () => {
  it('creates the operator, then resets its password and ends old sessions', async () => {
    const username = `seed-test-${randomUUID()}`;
    try {
      expect(await seedOperator(username, 'first password')).toBe('created');
      const first = await login({ username, password: 'first password' });
      const { header } = cookieFrom(first);
      expect((await me(header)).statusCode).toBe(200);

      expect(await seedOperator(username, 'second password')).toBe('updated');

      // Negative: a rotated password must end access gained with the old one.
      expect((await me(header)).statusCode).toBe(401);
      expect((await login({ username, password: 'first password' })).statusCode).toBe(401);
      expect((await login({ username, password: 'second password' })).statusCode).toBe(200);
    } finally {
      await prisma.operator.delete({ where: { username } });
    }
  });

  // Negative: compose re-seeds on every start; the same password must not
  // revoke sessions, rehash or add audit noise.
  it('is a no-op when the password is unchanged', async () => {
    const username = `seed-test-${randomUUID()}`;
    try {
      await seedOperator(username, 'stable password');
      const { header } = cookieFrom(await login({ username, password: 'stable password' }));
      const before = await prisma.operator.findUniqueOrThrow({ where: { username } });

      expect(await seedOperator(username, 'stable password')).toBe('unchanged');

      const after = await prisma.operator.findUniqueOrThrow({ where: { username } });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect((await me(header)).statusCode).toBe(200);
      expect(
        await prisma.auditEntry.count({ where: { action: 'operator.seeded', targetId: after.id } }),
      ).toBe(1);
    } finally {
      await prisma.operator.delete({ where: { username } });
    }
  });
});
