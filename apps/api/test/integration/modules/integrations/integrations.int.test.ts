import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/app.js';
import { signedInCookie } from '../../../fixtures/session.fixture.js';
import { loadConfig } from '../../../../src/platform/config/env.js';
import { prisma } from '../../../../src/db.js';
import { connectionListResponse, connectionResponse, connectionTestResponse, connectionView } from '../../../../src/modules/integrations/schemas.js';

const CREDENTIALS_KEY = randomBytes(32).toString('base64');
// Distinctive enough that finding it anywhere is unambiguous.
const SECRET = 'sk-live-CREDENTIAL-MUST-NEVER-APPEAR-4f2a9c';

const app = await buildApp({
  config: { ...loadConfig(), DEMO_ENABLED: false, CREDENTIALS_KEY },
});

const { cookie, operatorId } = await signedInCookie();

const authed = { headers: { cookie } };

async function clear() {
  // AuditEntry is append-only and the database enforces it, so these rows are
  // never deleted. Audit assertions below count a delta instead.
  await prisma.integrationConnection.deleteMany({});
}

async function auditCount(action: string): Promise<number> {
  return prisma.auditEntry.count({ where: { action } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const PUT = (provider: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'PUT' as const,
    url: `/api/integrations/${provider}`,
    ...authed,
    payload: body,
  });

describe('GET /api/integrations', () => {
  it('lists every provider, configured or not', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/integrations', ...authed });

    expect(response.statusCode).toBe(200);
    const parsed = connectionListResponse.parse(response.json());
    expect(parsed.data.map((entry) => entry.provider).sort()).toEqual(['cloudlabs', 'simulator']);
  });

  // The gate, visible from the API: a provider that verified nothing reports
  // not_configured and claims no capabilities.
  it('reports cloudlabs as not_configured, never connected', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/integrations', ...authed });
    const cloudlabs = connectionListResponse.parse(response.json()).data.find(
      (entry) => entry.provider === 'cloudlabs',
    );

    expect(cloudlabs?.state).toBe('not_configured');
    expect(cloudlabs?.capabilities.reachable).toBe(false);
    expect(cloudlabs?.capabilities.canExecuteRecovery).toBe(false);
  });

  it('never enables live recovery for any provider', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/integrations', ...authed });

    for (const entry of connectionListResponse.parse(response.json()).data) {
      expect(entry.capabilities.canExecuteRecovery).toBe(false);
    }
  });

  // Negative: these are not public routes.
  it('refuses an anonymous request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/integrations' });

    expect(response.statusCode).toBe(401);
  });
});

describe('PUT /api/integrations/:provider', () => {
  it('stores a credential and reports it only as a boolean', async () => {
    const response = await PUT('simulator', { displayName: 'Sim', credential: SECRET });

    expect(response.statusCode).toBe(200);
    const { data } = connectionResponse.parse(response.json());

    expect(data.hasCredential).toBe(true);
    expect(data.displayName).toBe('Sim');
  });

  // The test this phase exists for: the credential must not appear anywhere in
  // any serialised response.
  it('never echoes the credential in any response', async () => {
    const saved = await PUT('simulator', { displayName: 'Sim', credential: SECRET });
    expect(saved.body).not.toContain(SECRET);

    const listed = await app.inject({ method: 'GET', url: '/api/integrations', ...authed });
    expect(listed.body).not.toContain(SECRET);

    const tested = await app.inject({
      method: 'POST',
      url: '/api/integrations/simulator/test',
      ...authed,
    });
    expect(tested.body).not.toContain(SECRET);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/integrations/simulator',
      ...authed,
    });
    expect(removed.body).not.toContain(SECRET);
  });

  // Negative: the response schema is closed and carries no credential field, so
  // a credential could not be added to the payload even by accident.
  it('has no credential field on the response view at all', () => {
    const keys = Object.keys(connectionView.shape);

    expect(keys).toContain('hasCredential');
    expect(keys).not.toContain('credential');
    expect(keys).not.toContain('credentials');
    expect(keys).not.toContain('encryptedCredentials');
  });

  it('rejects a response that carries a credential field', () => {
    const valid = connectionResponse.parse({
      data: {
        provider: 'simulator',
        displayName: 'Sim',
        state: 'not_configured',
        hasCredential: false,
        supportedEventTypes: null,
        capabilities: {
          reachable: false,
          canReadLabs: false,
          canReceiveEvents: false,
          canRegisterWebhook: false,
          canTriggerSync: false,
          canExecuteRecovery: false,
        },
        lastSuccessfulTestAt: null,
        lastSyncAt: null,
        updatedAt: null,
      },
    });

    // Strict, so smuggling a field in is a parse failure rather than a leak.
    expect(() =>
      connectionResponse.parse({
        data: { ...valid.data, credentials: SECRET },
      }),
    ).toThrow();
  });

  it('seals the credential at rest rather than storing it', async () => {
    await PUT('simulator', { displayName: 'Sim', credential: SECRET });

    const row = await prisma.integrationConnection.findFirstOrThrow({
      where: { provider: 'simulator' },
    });

    expect(Buffer.from(row.encryptedCredentials ?? [])).not.toContain(SECRET);
    expect(Buffer.from(row.encryptedCredentials ?? []).toString('utf8')).not.toContain(SECRET);
  });

  it('updates rather than duplicating a second save', async () => {
    await PUT('simulator', { displayName: 'First', credential: SECRET });
    await PUT('simulator', { displayName: 'Second', credential: 'another-secret' });

    const rows = await prisma.integrationConnection.findMany({ where: { provider: 'simulator' } });

    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe('Second');
  });

  // Negative: the credential is audited by presence, never by value.
  it('audits the change without the credential', async () => {
    const before = await auditCount('integration.updated');
    await PUT('simulator', { displayName: 'Sim', credential: SECRET });

    const entries = await prisma.auditEntry.findMany({
      where: { action: 'integration.updated' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    expect(await auditCount('integration.updated')).toBe(before + 1);
    expect(entries[0].actorId).toBe(operatorId);
    expect(JSON.stringify(entries[0].metadata)).not.toContain(SECRET);
    expect(JSON.stringify(entries[0].metadata)).toContain('hasCredential');
  });

  // Negative: the state comes from the adapter, never from the request body.
  it('cannot be made connected by sending a state', async () => {
    const response = await PUT('cloudlabs', {
      displayName: 'CloudLabs',
      credential: SECRET,
      state: 'connected',
    });

    expect(response.statusCode).toBe(400);
    expect(await prisma.integrationConnection.count()).toBe(0);
  });

  it.each([
    ['a missing credential', { displayName: 'Sim' }],
    ['an empty credential', { displayName: 'Sim', credential: '' }],
    ['an unknown field', { displayName: 'Sim', credential: SECRET, state: 'connected' }],
  ])('rejects %s', async (_label, body) => {
    const response = await PUT('simulator', body);

    expect(response.statusCode).toBe(400);
    expect(await prisma.integrationConnection.count()).toBe(0);
  });

  it('refuses an unknown provider without storing anything', async () => {
    const response = await PUT('nope', { displayName: 'x', credential: SECRET });

    expect(response.statusCode).toBe(404);
    expect(await prisma.integrationConnection.count()).toBe(0);
  });

  it('refuses an anonymous request', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/integrations/simulator',
      payload: { displayName: 'Sim', credential: SECRET },
    });

    expect(response.statusCode).toBe(401);
    expect(await prisma.integrationConnection.count()).toBe(0);
  });

  // Negative: without a key the request must fail by name, never store plaintext.
  it('fails by name when no credentials key is configured', async () => {
    const keyless = await buildApp({
      config: { ...loadConfig(), DEMO_ENABLED: false },
      logger: undefined,
    });

    const response = await keyless.inject({
      method: 'PUT',
      url: '/api/integrations/simulator',
      ...authed,
      payload: { displayName: 'Sim', credential: SECRET },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'CREDENTIALS_KEY_MISSING' } });
    expect(response.body).not.toContain(SECRET);
    expect(await prisma.integrationConnection.count()).toBe(0);

    await keyless.close();
  });
});

describe('PUT /api/integrations/:provider boundaries', () => {
  // Negative: no verified provider has a tenant, so the field is refused, not
  // accepted and silently dropped.
  it('refuses a tenantId rather than discarding it', async () => {
    const response = await PUT('simulator', {
      displayName: 'Sim',
      credential: SECRET,
      tenantId: 'tenant-1',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(SECRET);
    expect(await prisma.integrationConnection.count()).toBe(0);
  });

  it('refuses an oversized provider name at the boundary', async () => {
    const response = await PUT('p'.repeat(65), { displayName: 'Sim', credential: SECRET });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});

describe('POST /api/integrations/:provider/test', () => {
  it('passes for the simulator and records the event types', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/integrations/simulator/test',
      ...authed,
    });

    const { data } = connectionTestResponse.parse(response.json());

    expect(data.ok).toBe(true);
    expect(data.state).toBe('connected');
    expect(data.eventTypes).toContain('provision_failed');
  });

  // The headline negative: the gate is closed, and the API must say so.
  it('fails for cloudlabs and never reports connected', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/integrations/cloudlabs/test',
      ...authed,
    });

    const { data } = connectionTestResponse.parse(response.json());

    expect(data.ok).toBe(false);
    expect(data.state).toBe('not_configured');
    expect(data.state).not.toBe('connected');
    expect(data.eventTypes).toBeUndefined();
  });

  it('audits a failed test as a failure', async () => {
    const before = await auditCount('integration.tested');
    await app.inject({ method: 'POST', url: '/api/integrations/cloudlabs/test', ...authed });

    const entries = await prisma.auditEntry.findMany({
      where: { action: 'integration.tested' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    expect(await auditCount('integration.tested')).toBe(before + 1);
    expect(entries[0].outcome).toBe('failure');
  });

  it('refuses an anonymous request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/integrations/simulator/test',
    });

    expect(response.statusCode).toBe(401);
  });

  // The original test tested cloudlabs with no stored row, so it never
  // exercised the path that matters: a credential saved, then a failed test.
  it('stays not_configured after a failed test on a saved credential', async () => {
    await PUT('cloudlabs', { displayName: 'CloudLabs', credential: SECRET });

    const response = await app.inject({
      method: 'POST',
      url: '/api/integrations/cloudlabs/test',
      ...authed,
    });

    const { data } = connectionTestResponse.parse(response.json());

    // "error" would claim a transient fault worth retrying. Nothing is
    // reachable, so it can never succeed and must not look retryable.
    expect(data.state).toBe('not_configured');
    expect(data.state).not.toBe('error');

    const row = await prisma.integrationConnection.findFirstOrThrow({
      where: { provider: 'cloudlabs' },
    });
    expect(row.state).toBe('not_configured');
  });

  // Negative: a failed test must not leave event types the provider no longer
  // confirms on display. Set on the same row the failing test touches, so the
  // assertion is about clearing and not about a row that was always empty.
  it('clears previously confirmed event types when a test fails', async () => {
    await PUT('cloudlabs', { displayName: 'CloudLabs', credential: SECRET });
    await app.inject({ method: 'POST', url: '/api/integrations/cloudlabs/test', ...authed });

    const row = await prisma.integrationConnection.findFirstOrThrow({
      where: { provider: 'cloudlabs' },
    });
    expect(row.supportedEventTypes).toEqual([]);

    // Now pretend an earlier successful test had confirmed some.
    await prisma.integrationConnection.update({
      where: { id: row.id },
      data: { supportedEventTypes: ['stale_event_type'] },
    });

    await app.inject({ method: 'POST', url: '/api/integrations/cloudlabs/test', ...authed });

    const after = await prisma.integrationConnection.findFirstOrThrow({
      where: { provider: 'cloudlabs' },
    });
    expect(after.supportedEventTypes).toEqual([]);
    expect(after.supportedEventTypes).not.toContain('stale_event_type');
  });
});

describe('a stored credential that cannot be opened', () => {
  const latestTestAudit = async () =>
    prisma.auditEntry.findFirstOrThrow({
      where: { action: 'integration.tested' },
      orderBy: { seq: 'desc' },
    });

  // Negative: a wrong key or altered bytes must leave a trace, not vanish.
  it('is recorded in the audit, without the credential', async () => {
    await PUT('simulator', { displayName: 'Sim', credential: SECRET });
    await app.inject({ method: 'POST', url: '/api/integrations/simulator/test', ...authed });
    expect(await latestTestAudit()).not.toHaveProperty('metadata.credentialUnreadable');

    const rekeyed = await buildApp({
      config: {
        ...loadConfig(),
        DEMO_ENABLED: false,
        CREDENTIALS_KEY: randomBytes(32).toString('base64'),
      },
    });
    const response = await rekeyed.inject({
      method: 'POST',
      url: '/api/integrations/simulator/test',
      ...authed,
    });
    await rekeyed.close();

    expect(response.statusCode).toBe(200);
    const entry = await latestTestAudit();
    expect(entry.metadata).toMatchObject({ credentialUnreadable: true });
    expect(JSON.stringify(entry.metadata)).not.toContain(SECRET);
  });
});

describe('DELETE /api/integrations/:provider', () => {
  it('removes the connection and its stored credential', async () => {
    await PUT('simulator', { displayName: 'Sim', credential: SECRET });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/integrations/simulator',
      ...authed,
    });

    expect(response.statusCode).toBe(200);
    expect(connectionResponse.parse(response.json()).data.hasCredential).toBe(false);
    expect(await prisma.integrationConnection.count()).toBe(0);
  });

  // Negative: disconnecting something never configured is not an error, and
  // must not invent a row.
  it('is harmless when nothing was configured', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/integrations/cloudlabs',
      ...authed,
    });

    expect(response.statusCode).toBe(200);
    expect(await prisma.integrationConnection.count()).toBe(0);
  });

  it('audits the disconnect', async () => {
    const before = await auditCount('integration.disconnected');
    await PUT('simulator', { displayName: 'Sim', credential: SECRET });
    await app.inject({ method: 'DELETE', url: '/api/integrations/simulator', ...authed });

    const entries = await prisma.auditEntry.findMany({
      where: { action: 'integration.disconnected' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    expect(await auditCount('integration.disconnected')).toBe(before + 1);
    expect(JSON.stringify(entries[0].metadata)).toContain('"existed":true');
  });

  it('refuses an anonymous request', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/integrations/simulator' });

    expect(response.statusCode).toBe(401);
  });
});