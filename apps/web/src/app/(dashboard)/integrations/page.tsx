import { Check, Minus, PlugZap, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import type { BadgeVariant } from '@/components/ui/badge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { apiGet } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
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

const STATE_VARIANT: Record<string, BadgeVariant> = {
  not_configured: 'neutral',
  connecting: 'info',
  connected: 'success',
  error: 'danger',
  needs_attention: 'warning',
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
    <>
      <PageHeader
        title="Integration settings"
        description="Each provider reports only the capabilities it has actually verified. Nothing here is inferred from a product's public description."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {connections.map((connection) => (
          <ProviderCard key={connection.provider} connection={connection} />
        ))}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldAlert className="size-4 shrink-0" />
        Recovery against a live provider stays disabled. Connecting a data source never enables
        execution against real infrastructure.
      </p>
    </>
  );
}

function ProviderCard({ connection }: { connection: IntegrationConnection }) {
  const verifiedNothing = !connection.capabilities.reachable;
  const capabilities = Object.entries(connection.capabilities) as [
    keyof IntegrationConnection['capabilities'],
    boolean,
  ][];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <PlugZap className="size-4" />
          </span>
          <div>
            <h2 className="font-semibold">{connection.displayName}</h2>
            <p className="text-xs text-muted-foreground">
              {connection.provider}
              {connection.hasCredential ? ' · credential stored' : ' · no credential stored'}
            </p>
          </div>
        </div>
        <Badge variant={STATE_VARIANT[connection.state] ?? 'neutral'}>
          {STATE_LABEL[connection.state] ?? connection.state}
        </Badge>
      </div>

      {verifiedNothing && (
        <p className="mt-4 rounded-lg border bg-muted px-3 py-2 text-sm">
          No capabilities are claimed. The API contract, credentials and sandbox access have not
          been confirmed, so this connection cannot do anything yet. That is the honest state, not
          a stub.
        </p>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {capabilities.map(([key, enabled]) => (
          <div key={key} className="flex items-center justify-between text-sm">
            <dt className="text-muted-foreground">{CAPABILITY_LABEL[key]}</dt>
            <dd className={`flex items-center gap-1 ${enabled ? 'text-success' : 'text-muted-foreground'}`}>
              {enabled ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
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
          Last successful test {formatDateTime(connection.lastSuccessfulTestAt)}
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