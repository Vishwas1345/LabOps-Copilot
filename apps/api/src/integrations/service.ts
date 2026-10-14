// Integration settings. Owns the IntegrationConnection table.
//
// Two rules run through everything here:
//   - a credential is sealed on the way in and opened only inside an adapter's
//     testConnection, never selected into a view or a log
//   - the state is derived from what the adapter reported, so a connection that
//     verified nothing cannot read as connected
//
// The credentials key arrives as an argument rather than from process.env,
// matching how the rest of the app takes its configuration.

import type { Prisma } from '@prisma/client';
import type { Actor } from '../audit/audit.js';
import { writeAudit } from '../audit/audit.js';
import { prisma } from '../db.js';
import { openSecret, parseCredentialsKey, sealSecret, SecretUnavailableError } from '../secrets/crypto.js';
import type { IntegrationState, ProviderAdapter } from './adapter.js';
import { stateFor } from './adapter.js';
import type { ConnectionView, SaveConnectionBody } from './schemas.js';

const TARGET_TYPE = 'IntegrationConnection';

export interface IntegrationDeps {
  adapters: ProviderAdapter[];
  /** Undefined when CREDENTIALS_KEY is unset; saving then fails by name. */
  credentialsKey: string | undefined;
}

export class UnknownProviderError extends Error {
  constructor(provider: string) {
    super(`unknown provider: ${provider}`);
    this.name = 'UnknownProviderError';
  }
}

export class CredentialsKeyMissingError extends Error {
  constructor() {
    super('no credentials key is configured; cannot store a credential');
    this.name = 'CredentialsKeyMissingError';
  }
}

type Row = Prisma.IntegrationConnectionGetPayload<Record<string, never>>;

/**
 * Builds the view. `encryptedCredentials` is read only as a boolean; the bytes
 * themselves never leave this function.
 */
function toView(row: Row, adapter: ProviderAdapter): ConnectionView {
  return {
    provider: row.provider,
    displayName: row.displayName,
    state: row.state as ConnectionView['state'],
    hasCredential: row.encryptedCredentials !== null,
    supportedEventTypes: (row.supportedEventTypes as string[] | null) ?? null,
    capabilities: adapter.capabilities,
    lastSuccessfulTestAt: row.lastSuccessfulTestAt?.toISOString() ?? null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What an unconfigured provider looks like: known, and honest about it. */
function unconfiguredView(adapter: ProviderAdapter): ConnectionView {
  return {
    provider: adapter.provider,
    displayName: adapter.displayName,
    state: stateFor(adapter.capabilities),
    hasCredential: false,
    supportedEventTypes: null,
    capabilities: adapter.capabilities,
    lastSuccessfulTestAt: null,
    lastSyncAt: null,
    updatedAt: null,
  };
}

function requireAdapter(deps: IntegrationDeps, provider: string): ProviderAdapter {
  const adapter = deps.adapters.find((candidate) => candidate.provider === provider);
  if (!adapter) throw new UnknownProviderError(provider);
  return adapter;
}

/**
 * Every provider the settings page knows about, configured or not, so the UI
 * can show what exists rather than only what has been set up.
 */
export async function listConnections(deps: IntegrationDeps): Promise<ConnectionView[]> {
  const rows = await prisma.integrationConnection.findMany();

  return deps.adapters.map((adapter) => {
    const row = rows.find((candidate) => candidate.provider === adapter.provider);
    return row ? toView(row, adapter) : unconfiguredView(adapter);
  });
}

/**
 * Stores a sealed credential with its configuration. The change and its audit
 * entry commit together, so a connection can never exist unrecorded.
 */
export async function saveConnection(
  deps: IntegrationDeps,
  provider: string,
  body: SaveConnectionBody,
  actor: Actor,
): Promise<ConnectionView> {
  const adapter = requireAdapter(deps, provider);

  let sealed: Buffer;
  try {
    sealed = sealSecret(body.credential, parseCredentialsKey(deps.credentialsKey));
  } catch (error) {
    // Named, never echoed: the failing value would be the credential itself.
    if (error instanceof SecretUnavailableError) throw new CredentialsKeyMissingError();
    throw error;
  }

  const state = stateFor(adapter.capabilities);

  // Prisma types Bytes as Uint8Array<ArrayBuffer>; node's crypto returns a
  // Buffer. Converted at the boundary rather than cast, so a wrong type here is
  // a compile error instead of a runtime surprise.
  const sealedBytes = new Uint8Array(sealed);

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.integrationConnection.upsert({
      where: { provider },
      create: {
        provider,
        displayName: body.displayName,
        state,
        encryptedCredentials: sealedBytes,
        keyVersion: 1,
        updatedBy: actor.id,
      },
      update: {
        displayName: body.displayName,
        encryptedCredentials: sealedBytes,
        keyVersion: 1,
        updatedBy: actor.id,
      },
    });

    await writeAudit(tx, {
      actor,
      action: 'integration.updated',
      targetType: TARGET_TYPE,
      targetId: saved.id,
      outcome: 'success',
      // Never the credential, not even hashed: the audit row lives forever.
      metadata: { provider, state, hasCredential: true },
    });

    return saved;
  });

  return toView(row, adapter);
}

/** Removes the connection and its stored credential. */
export async function deleteConnection(
  deps: IntegrationDeps,
  provider: string,
  actor: Actor,
): Promise<ConnectionView> {
  const adapter = requireAdapter(deps, provider);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.integrationConnection.findUnique({ where: { provider } });

    if (existing) {
      await tx.integrationConnection.delete({ where: { id: existing.id } });
    }

    await writeAudit(tx, {
      actor,
      action: 'integration.disconnected',
      targetType: TARGET_TYPE,
      targetId: existing?.id ?? provider,
      outcome: 'success',
      metadata: { provider, existed: existing !== null },
    });
  });

  return unconfiguredView(adapter);
}

/**
 * The state a failed test should leave behind.
 *
 * `error` means "retrying might work". An adapter with nothing reachable cannot
 * succeed later, because the integration gate is closed until Spektra supplies
 * documentation - so it stays `not_configured` rather than claiming a transient
 * fault that will never clear.
 */
function stateAfterFailedTest(adapter: ProviderAdapter, row: Row | null): IntegrationState {
  if (!adapter.capabilities.reachable) return stateFor(adapter.capabilities);
  // A capable provider with nothing stored was never configured to fail.
  if (!row) return 'not_configured';
  return 'error';
}

export interface TestOutcome {
  provider: string;
  ok: boolean;
  detail: string;
  eventTypes?: string[];
  state: IntegrationState;
}

/**
 * Runs the adapter's own probe and records the result. The credential is opened
 * here and nowhere else; the adapter's detail lands in the audit, never the
 * secret.
 */
export async function testConnection(
  deps: IntegrationDeps,
  provider: string,
  actor: Actor,
): Promise<TestOutcome> {
  const adapter = requireAdapter(deps, provider);
  const row = await prisma.integrationConnection.findUnique({ where: { provider } });

  let credential: string | undefined;
  if (row?.encryptedCredentials) {
    try {
      credential = openSecret(
        Buffer.from(row.encryptedCredentials),
        parseCredentialsKey(deps.credentialsKey),
      );
    } catch {
      // An unreadable credential is not a reason to fail the probe: the adapter
      // is what decides, and it will say so in its own detail.
      credential = undefined;
    }
  }

  const result = await adapter.testConnection({ credentials: credential });
  const state = result.ok
    ? stateFor(adapter.capabilities)
    : stateAfterFailedTest(adapter, row);

  await prisma.$transaction(async (tx) => {
    if (row) {
      await tx.integrationConnection.update({
        where: { id: row.id },
        data: {
          state,
          // Cleared on failure as well as set on success. Leaving previously
          // confirmed event types in place would have the UI offering
          // subscriptions the provider no longer confirms, which is the exact
          // failure this module exists to prevent.
          supportedEventTypes: result.ok ? (result.eventTypes ?? []) : [],
          ...(result.ok ? { lastSuccessfulTestAt: new Date() } : {}),
        },
      });
    }

    await writeAudit(tx, {
      actor,
      action: 'integration.tested',
      targetType: TARGET_TYPE,
      targetId: row?.id ?? provider,
      outcome: result.ok ? 'success' : 'failure',
      metadata: { provider, state, eventTypes: result.eventTypes?.length ?? 0 },
    });
  });

  return { provider, ok: result.ok, detail: result.detail, eventTypes: result.eventTypes, state };
}