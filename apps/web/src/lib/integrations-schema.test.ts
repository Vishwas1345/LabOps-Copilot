import { describe, expect, it } from 'vitest';
import { integrationConnectionSchema, integrationsSchema } from './schemas';

const CLOUDLABS = {
  provider: 'cloudlabs',
  displayName: 'CloudLabs',
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
};

describe('integrationConnectionSchema', () => {
  it('parses a provider that verified nothing', () => {
    expect(integrationConnectionSchema.parse(CLOUDLABS)).toMatchObject({
      provider: 'cloudlabs',
      state: 'not_configured',
    });
  });

  // The mirror of the API property: the page cannot render a credential
  // because it has nowhere to read one from.
  it('has no credential field to render', () => {
    const keys = Object.keys(integrationConnectionSchema.shape);

    expect(keys).toContain('hasCredential');
    expect(keys).not.toContain('credential');
    expect(keys).not.toContain('credentials');
    expect(keys).not.toContain('encryptedCredentials');
  });

  it('does not surface a credential the API might have smuggled in', () => {
    const parsed = integrationConnectionSchema.parse({
      ...CLOUDLABS,
      credential: 'sk-live-LEAK',
      encryptedCredentials: 'AAAA',
    });

    expect(JSON.stringify(parsed)).not.toContain('sk-live-LEAK');
    expect(JSON.stringify(parsed)).not.toContain('encryptedCredentials');
  });

  it('requires the capability block, so a partial payload errors rather than rendering', () => {
    const { capabilities: _dropped, ...withoutCapabilities } = CLOUDLABS;

    expect(() => integrationConnectionSchema.parse(withoutCapabilities)).toThrow();
  });

  it('renders simulator mode when the provider is reachable', () => {
    const parsed = integrationConnectionSchema.parse({
      ...CLOUDLABS,
      provider: 'simulator',
      state: 'connected',
      hasCredential: true,
      capabilities: { ...CLOUDLABS.capabilities, reachable: true, canReadLabs: true },
      supportedEventTypes: ['provision_failed'],
    });

    expect(parsed.state).toBe('connected');
    expect(parsed.capabilities.canReadLabs).toBe(true);
    expect(parsed.supportedEventTypes).toEqual(['provision_failed']);
  });
});

describe('integrationsSchema', () => {
  it('parses the list the settings page renders', () => {
    const parsed = integrationsSchema.parse({ data: [CLOUDLABS] });

    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].provider).toBe('cloudlabs');
  });

  // Negative: a malformed API response is an error state, not a crash.
  it('rejects a payload that is not the expected shape', () => {
    expect(() => integrationsSchema.parse({ data: [{ provider: 'cloudlabs' }] })).toThrow();
    expect(() => integrationsSchema.parse({ nope: true })).toThrow();
    expect(() => integrationsSchema.parse(null)).toThrow();
  });
});