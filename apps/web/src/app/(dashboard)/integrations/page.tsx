import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { apiGet } from '@/lib/api';
import { integrationsSchema } from '@/lib/schemas';
import type { IntegrationConnection } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

const STATE_LABEL: Record<string, string> = {
  not_configured: 'Not configured',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Error',
  needs_attention: 'Needs attention',
};

const STATE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  not_configured: 'secondary',
  connecting: 'default',
  connected: 'default',
  error: 'destructive',
  needs_attention: 'destructive',
};

const CAPABILITY_LABEL: Record<keyof IntegrationConnection['capabilities'], string> = {
  reachable: 'Reachable',
  canReadLabs: 'Read labs',
  canReceiveEvents: 'Receive events',
  canRegisterWebhook: 'Register webhook',
  canTriggerSync: 'Trigger sync',
  canExecuteRecovery: 'Execute recovery',
};

export default async function IntegrationsPage() {
  const { data: connections } = await apiGet('/api/integrations', integrationsSchema);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Integration settings</h1>
        <p className="text-sm text-muted-foreground">
          Each provider reports only the capabilities it has actually verified. Nothing here is
          inferred from a product&apos;s public description.
        </p>
      </div>

      {connections.map((connection) => (
        <ProviderCard key={connection.provider} connection={connection} />
      ))}

      <p className="text-sm text-muted-foreground">
        Recovery against a live provider stays disabled. Connecting a data source never enables
        execution against real infrastructure.
      </p>
    </div>
  );
}

function ProviderCard({ connection }: { connection: IntegrationConnection }) {
  const verifiedNothing = !connection.capabilities.reachable;
  const capabilities = Object.entries(connection.capabilities) as [
    keyof IntegrationConnection['capabilities'],
    boolean,
  ][];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">{connection.displayName}</h2>
          <p className="text-xs text-muted-foreground">
            {connection.provider}
            {connection.hasCredential ? ' · credential stored' : ' · no credential stored'}
          </p>
        </div>
        <Badge variant={STATE_VARIANT[connection.state] ?? 'secondary'}>
          {STATE_LABEL[connection.state] ?? connection.state}
        </Badge>
      </div>

      {verifiedNothing && (
        <p className="mt-3 rounded border border-border bg-muted px-3 py-2 text-sm">
          No capabilities are claimed. The API contract, credentials and sandbox access have not
          been confirmed, so this connection cannot do anything yet. That is the honest state, not
          a stub.
        </p>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {capabilities.map(([key, enabled]) => (
          <div key={key} className="flex items-center justify-between text-sm">
            <dt className="text-muted-foreground">{CAPABILITY_LABEL[key]}</dt>
            <dd className={enabled ? 'text-foreground' : 'text-muted-foreground'}>
              {enabled ? 'available' : 'unavailable'}
            </dd>
          </div>
        ))}
      </dl>

      {connection.supportedEventTypes && connection.supportedEventTypes.length > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Event types the provider confirmed:{' '}
          <span className="text-foreground">{connection.supportedEventTypes.join(', ')}</span>
        </p>
      )}

      {connection.lastSuccessfulTestAt && (
        <p className="mt-2 text-sm text-muted-foreground">
          Last successful test {connection.lastSuccessfulTestAt}
        </p>
      )}

      {/* No save form yet: the auth scheme is unknown, and rendering fields
          for it would be inventing a contract. See ARCHITECTURE.md section 13. */}
      <p className="mt-4 text-xs text-muted-foreground">
        Connection fields are not shown because the authentication method is not confirmed.{' '}
        <Link href="/audit" className="underline">
          Audit trail
        </Link>{' '}
        records every change.
      </p>
    </Card>
  );
}