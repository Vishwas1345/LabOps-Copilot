// The CloudLabs connector.
//
// It performs no network call, because no API contract has been verified. The
// public integrations page advertises REST APIs and webhooks, but endpoints,
// auth scheme, scopes, rate limits, payload shapes and webhook signing are all
// unconfirmed, and recovery actions may not be exposed at all.
//
// This adapter therefore reports no capabilities, which makes the connection
// read not_configured. That is the correct outcome, not a stub pretending to
// work: the integration gate (ARCHITECTURE.md section 13) requires official
// documentation, credentials and a sandbox before any of this is implemented.
//
// To change anything below, first confirm the capability against Spektra's
// documentation, then implement it and report it here. Do not guess.

import type {
  ConnectionConfig,
  ConnectionResult,
  ProviderAdapter,
  ProviderCapabilities,
} from './adapter.js';
import { NO_CAPABILITIES } from './adapter.js';

export const cloudlabsCapabilities: ProviderCapabilities = NO_CAPABILITIES;

export const cloudlabsAdapter: ProviderAdapter = {
  provider: 'cloudlabs',
  displayName: 'CloudLabs',
  capabilities: cloudlabsCapabilities,

  async testConnection(_config: ConnectionConfig): Promise<ConnectionResult> {
    return {
      ok: false,
      detail:
        'Not verified. The CloudLabs API contract, credentials and sandbox access are not available, so no capability is claimed.',
    };
  },
};