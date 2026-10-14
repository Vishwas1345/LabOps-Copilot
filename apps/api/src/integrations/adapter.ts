// The provider boundary.
//
// The point of this interface is not to make CloudLabs pluggable. It is to make
// the *absence* of a verified integration representable: an adapter reports
// what it can actually do, and an adapter that has verified nothing reports
// nothing, so the connection reads not_configured rather than connected.
//
// Anything optional here is optional because the capability is unverified. Do
// not add a method until it is confirmed against official documentation, and do
// not infer an endpoint, an auth scheme or a webhook contract from the method
// name. See ARCHITECTURE.md section 13.

/**
 * What an adapter reports it can do. The settings page renders this and nothing
 * else, so a capability that is absent here is absent from the UI too.
 */
export interface ProviderCapabilities {
  /** Can this adapter reach the provider at all right now? */
  reachable: boolean;
  /** Can it list labs or statuses. */
  canReadLabs: boolean;
  /** Can it receive inbound events, and if so by polling or webhook. */
  canReceiveEvents: boolean;
  canRegisterWebhook: boolean;
  canTriggerSync: boolean;
  /**
   * Recovery against the live provider. Always false in the MVP: configuring a
   * data connection must never enable execution against real infrastructure.
   */
  canExecuteRecovery: false;
}

export interface ConnectionConfig {
  /** Tenant or environment identifier, where the provider has one. */
  tenantId?: string;
  /** Sealed credentials, opened only inside testConnection. */
  credentials?: string;
}

export interface ConnectionResult {
  ok: boolean;
  /** Operator-facing reason. Never contains the credential. */
  detail: string;
  /** Event types the provider actually confirmed, not the ones we hoped for. */
  eventTypes?: string[];
}

export interface ProviderAdapter {
  readonly provider: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Probes the provider with the supplied configuration. Must not mutate
   * stored state and must never echo the credential into its result.
   */
  testConnection(config: ConnectionConfig): Promise<ConnectionResult>;
}

/** Nothing has been verified, so nothing is claimed. */
export const NO_CAPABILITIES: ProviderCapabilities = {
  reachable: false,
  canReadLabs: false,
  canReceiveEvents: false,
  canRegisterWebhook: false,
  canTriggerSync: false,
  canExecuteRecovery: false,
};

/**
 * The state an adapter with the given capabilities justifies. Derived, not
 * chosen: an adapter that reports nothing reachable can never be connected.
 */
export function stateFor(capabilities: ProviderCapabilities): IntegrationState {
  if (!capabilities.reachable) return 'not_configured';
  if (!capabilities.canReadLabs && !capabilities.canReceiveEvents) return 'needs_attention';
  return 'connected';
}

export type IntegrationState =
  | 'not_configured'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'needs_attention';