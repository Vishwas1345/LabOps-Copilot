import { describe, expect, it } from 'vitest';
import { cloudlabsAdapter } from '../../../../src/modules/integrations/adapters/cloudlabs-adapter.js';
import { NO_CAPABILITIES, stateFor } from '../../../../src/modules/integrations/adapters/adapter.js';
import { simulatorAdapter, simulatorCapabilities } from '../../../../src/modules/integrations/adapters/simulator-adapter.js';

describe('cloudlabsAdapter', () => {
  // The integration gate, expressed as a test. Until Spektra supplies official
  // documentation, credentials and a sandbox, this adapter must claim nothing.
  it('claims no capabilities, because nothing has been verified', () => {
    expect(cloudlabsAdapter.capabilities).toEqual(NO_CAPABILITIES);
    expect(cloudlabsAdapter.capabilities.reachable).toBe(false);
    expect(cloudlabsAdapter.capabilities.canExecuteRecovery).toBe(false);
  });

  // Negative: an adapter that cannot reach the provider can never be connected.
  it('is not_configured, never connected', () => {
    expect(stateFor(cloudlabsAdapter.capabilities)).toBe('not_configured');
  });

  it('fails a connection test instead of pretending to succeed', async () => {
    const result = await cloudlabsAdapter.testConnection({});

    expect(result.ok).toBe(false);
    expect(result.eventTypes).toBeUndefined();
  });

  // Negative: a failing test must not claim event types either, or the UI would
  // offer subscriptions the provider never confirmed.
  it('claims no event types from a failed test', async () => {
    const result = await cloudlabsAdapter.testConnection({ credentials: 'anything' });

    expect(result.detail).not.toContain('anything');
    expect(result.detail).toMatch(/not verified/i);
  });

  it('never puts a credential in the failure detail', async () => {
    const secret = 'super-secret-credential-value';

    const result = await cloudlabsAdapter.testConnection({ credentials: secret });

    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('simulatorAdapter', () => {
  it('reports the capabilities the simulator genuinely has', () => {
    expect(simulatorAdapter.capabilities.reachable).toBe(true);
    expect(simulatorAdapter.capabilities.canReadLabs).toBe(true);
    expect(simulatorAdapter.capabilities.canExecuteRecovery).toBe(false);
  });

  it('passes a connection test without contacting anything', async () => {
    const result = await simulatorAdapter.testConnection({});

    expect(result.ok).toBe(true);
    expect(result.eventTypes).toContain('provision_failed');
  });

  // Negative: even a working data connection must never enable live recovery.
  it('never claims recovery, whatever else it can do', () => {
    expect(simulatorAdapter.capabilities.canExecuteRecovery).toBe(false);
  });
});

describe('stateFor', () => {
  it('derives connected only from a reachable adapter that can read or receive', () => {
    expect(stateFor(simulatorCapabilities)).toBe('connected');
  });

  it.each([
    ['nothing reachable', { ...NO_CAPABILITIES }, 'not_configured'],
    [
      'reachable but useless',
      { ...NO_CAPABILITIES, reachable: true },
      'needs_attention',
    ],
    [
      'reachable and receiving',
      { ...NO_CAPABILITIES, reachable: true, canReceiveEvents: true },
      'connected',
    ],
  ])('maps %s to %s', (_label, capabilities, expected) => {
    expect(stateFor(capabilities)).toBe(expected);
  });

  // Negative: no capability combination may produce a state the enum lacks.
  it.each([{}, { reachable: true }, { reachable: false, canReadLabs: true }])(
    'always returns a declared state for %j',
    (partial) => {
      const capabilities = { ...NO_CAPABILITIES, ...partial };
      expect([
        'not_configured',
        'connecting',
        'connected',
        'error',
        'needs_attention',
      ]).toContain(stateFor(capabilities));
    },
  );
});