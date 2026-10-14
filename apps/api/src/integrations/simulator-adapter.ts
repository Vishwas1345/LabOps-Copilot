// The simulator adapter. Always available, and the one the demo runs against.
//
// It reports the capabilities a simulated provider genuinely has, so the
// settings page has something real to render in simulator mode - and so the
// difference between "can do this" and "cannot" is visible in the UI rather
// than only in a test.

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