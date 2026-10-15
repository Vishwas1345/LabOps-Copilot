// Boundaries for the integrations API. A view has no credential field, and
// the routes send every response through these strict schemas, so a credential
// added to a view by mistake fails the request instead of leaving the process.

import { z } from 'zod';

// Bounded generously for a real key, tightly enough that a paste of an entire
// file is rejected rather than stored.
const credential = z.string().min(1).max(2000);

export const saveConnectionBody = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    credential,
  })
  .strict();

const integrationState = z.enum([
  'not_configured',
  'connecting',
  'connected',
  'error',
  'needs_attention',
]);

export const providerParams = z.object({ provider: z.string().min(1).max(64) }).strict();

export type SaveConnectionBody = z.infer<typeof saveConnectionBody>;

/**
 * What the API is willing to say about a connection. There is no credential
 * field here on purpose; encryptedCredentials never leaves the database.
 */
export const connectionView = z
  .object({
    provider: z.string(),
    displayName: z.string(),
    state: integrationState,
    hasCredential: z.boolean(),
    supportedEventTypes: z.array(z.string()).nullable(),
    capabilities: z.object({
      reachable: z.boolean(),
      canReadLabs: z.boolean(),
      canReceiveEvents: z.boolean(),
      canRegisterWebhook: z.boolean(),
      canTriggerSync: z.boolean(),
      canExecuteRecovery: z.literal(false),
    }),
    lastSuccessfulTestAt: z.string().nullable(),
    lastSyncAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strict();

export type ConnectionView = z.infer<typeof connectionView>;

export const connectionListResponse = z.object({ data: z.array(connectionView) }).strict();
export const connectionResponse = z.object({ data: connectionView }).strict();

export const connectionTestResponse = z
  .object({
    data: z
      .object({
        provider: z.string(),
        ok: z.boolean(),
        detail: z.string(),
        eventTypes: z.array(z.string()).optional(),
        state: integrationState,
      })
      .strict(),
  })
  .strict();