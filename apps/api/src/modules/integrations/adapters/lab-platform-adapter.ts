// The external lab platform connector. No API contract is verified, so it makes no network
// call and claims no capability, and the connection reads not_configured. The
// integration gate (ARCHITECTURE.md section 13) says what would change that.

import type {
  ConnectionConfig,
  ConnectionResult,
  ProviderAdapter,
  ProviderCapabilities,
} from './adapter.js';
import { NO_CAPABILITIES } from './adapter.js';

export const labPlatformCapabilities: ProviderCapabilities = NO_CAPABILITIES;

export const labPlatformAdapter: ProviderAdapter = {
  provider: 'lab-platform',
  displayName: 'External lab platform',
  capabilities: labPlatformCapabilities,

  async testConnection(_config: ConnectionConfig): Promise<ConnectionResult> {
    return {
      ok: false,
      detail:
        'Not verified. The platform API contract, credentials and sandbox access are not available, so no capability is claimed.',
    };
  },
};