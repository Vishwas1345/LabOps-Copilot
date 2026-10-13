---
name: cloudlabs-adapter
description: Use when working on the integrations module - provider adapter interface, connection settings, credential storage, webhook receiver, or sync jobs. Enforces the integration gate - implement only capabilities verified against official documentation, never invent endpoints or auth schemes.
---

# Working on the CloudLabs integration layer

## Preconditions

Read `ARCHITECTURE.md §13` (integration gate) and `CLAUDE.md §5` (prompt
injection and untrusted external input).

**The gate:** a live adapter method may only be implemented when it is verified
against official CloudLabs documentation, with credentials and sandbox access
supplied by Spektra. Until then the connection stays `simulated` and reads
`not_configured`.

## Where things go

```
apps/api/src/integrations/
  adapter.ts       ProviderAdapter interface
  simulator.ts     simulator adapter (always available)
  cloudlabs.ts     CloudLabs adapter — verified methods only
  connection.ts    connection state, capabilities
  webhook.ts       receiver, verification, normalisation
  secrets/         envelope encryption, redaction
```

## Procedure

1. **Keep every adapter method optional.**

   ```ts
   interface ProviderAdapter {
     testConnection(cfg: ProviderConfig): Promise<ConnectionResult>;
     fetchLabs?(cfg: ProviderConfig): Promise<NormalizedLab[]>;
     registerWebhook?(cfg: ProviderConfig, target: WebhookTarget): Promise<void>;
     normalizeIncomingEvent(raw: unknown, headers: Headers): NormalizedEvent;
     readonly supportedEventTypes: readonly string[];
     readonly capabilities: ProviderCapabilities;
   }
   ```

2. **Report capabilities at runtime.** The UI renders only what the adapter
   reports. Never present an unverified event type as available. Never display a
   generated webhook receiver URL unless CloudLabs is documented to support
   customer-configured webhook delivery.

3. **Never invent provider behaviour.** Do not invent endpoints, auth schemes,
   webhook signing, event types, rate limits or scopes. If it is not in the
   official documentation, it is not implemented — mark it unsupported and note
   the limitation.

4. **Normalise into the same internal event schema as the simulator.** Provider
   payloads and simulated events must enter the identical
   event → correlation → investigation → recovery pipeline. That shared path is
   the entire point of the adapter boundary.

5. **Preserve provider event IDs for deduplication.** Store source and provider
   metadata. Support replay or reprocessing without creating duplicate incidents
   or duplicate recovery jobs.

## Credential handling

- Submitted **server-side over HTTPS**. Never through a URL, never from browser
  storage, never in a `NEXT_PUBLIC_*` variable.
- Encrypted at rest with an envelope key from the environment.
- **Never returned by any endpoint. Never logged. Never in an AI context.**
- Least privilege and read-only by default.
- Real recovery actions against a live provider stay disabled behind a
  separately reviewed, sandboxed flag. Configuring a data connection does not
  enable execution.

## Webhook receiver

Inbound deliveries are untrusted input:

1. Verify the **documented** signature or token. If signing is unsupported,
   apply the strongest documented authentication and record the limitation.
2. Enforce a timestamp replay window.
3. Apply body size and rate limits.
4. Normalise, redact, then persist.
5. Write an audit entry for every delivery outcome.

Never retain the full raw payload by default. If raw retention is needed for
debugging, redact it and time-box it.

## Mandatory negative tests

- Unsigned / wrongly signed webhook → rejected, delivery logged as rejected
- Replayed webhook inside the window → deduplicated, no second incident
- Oversized body → rejected before parsing
- Adapter reporting no capabilities → settings page shows the connection as
  unavailable, and renders no event-type options
- Response to every endpoint contains no credential material

## Verify

```bash
npm run build -w @labops/api
```

If any live capability is genuinely verified and implemented, update
`ARCHITECTURE.md §13` and the endpoint table in `README.md`. If it is not, say
so plainly — an honest `not_configured` is the correct outcome, not a stub that
pretends to work.
