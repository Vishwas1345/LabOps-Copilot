// The simulator adapter, which the demo runs against. It reports what a
// simulated provider genuinely has, so "can" and "cannot" both show in the UI.

import type {
  ConnectionConfig,
  ConnectionResult,
  ProviderAdapter,
  ProviderCapabilities,
} from './adapter.js';

export const simulatorCapabilities: ProviderCapabilities = {
  reachable: true,
  canReadLabs: true,
  canReceiveEvents: true,
  canRegisterWebhook: false,
  canTriggerSync: true,
  // Recovery against a live provider is never enabled by configuring data.
  canExecuteRecovery: false,
};

export const simulatorAdapter: ProviderAdapter = {
  provider: 'simulator',
  displayName: 'Simulated provider',
  capabilities: simulatorCapabilities,

  async testConnection(_config: ConnectionConfig): Promise<ConnectionResult> {
    return {
      ok: true,
      detail: 'Simulated provider is always available. No external system is contacted.',
      eventTypes: ['provision_failed', 'lab_ready', 'permission_denied'],
    };
  },
};