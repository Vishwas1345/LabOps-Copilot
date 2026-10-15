import {
  FlaskConical,
  Play,
  ShieldCheck,
  ShieldX,
  Siren,
  Timer,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import type { z } from 'zod';
import { BarList } from '@/components/dashboard/bar-list';
import { FailureTimeline } from '@/components/dashboard/failure-timeline';
import { KpiTile } from '@/components/dashboard/kpi-tile';
import { LabsDonut } from '@/components/dashboard/labs-donut';
import { EmptyState } from '@/components/empty-state';
import { FilterGroup } from '@/components/filter-group';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api';
import { colourFor, ranked } from '@/lib/charts';
import { formatDateTime, formatDuration, humanise } from '@/lib/format';
import { WINDOWS, windowFrom } from '@/lib/queries';
import {
  auditFeedSchema,
  failureSeriesSchema,
  incidentListSchema,
  labSummarySchema,
  metricsSchema,
} from '@/lib/schemas';
import { runDemoScenario } from './demo-action';

type Metrics = z.infer<typeof metricsSchema>['data'];
type Duration = Metrics['incidents']['timeToIdentify'];

const ACTIVE = ['open', 'investigating', 'awaiting_approval', 'recovering', 'manual_review'];

const p95Caption = (summary: Duration, unit: string) =>
  summary.samples === 0 ? 'nothing measured yet' : `p95 ${formatDuration(summary.p95Ms)} · ${summary.samples} ${unit}`;

const OUTCOME_COLOURS: Record<string, string> = {
  succeeded: 'var(--success)',
  failed: 'var(--danger)',
  rejected_by_policy: 'var(--danger)',
  blocked: 'var(--danger)',
  awaiting_approval: 'var(--warning)',
  expired: 'var(--muted-foreground)',
  rejected: 'var(--muted-foreground)',
};

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; window?: string }>;
}) {
  const params = await searchParams;
  const windowKey = windowFrom(params.window);
  const hours = WINDOWS[windowKey];
  const [
    { data: labs },
    { data: metrics },
    { data: timeline },
    { data: awaiting },
    { data: review },
    { data: activity },
  ] = await Promise.all([
    apiGet('/api/labs/summary', labSummarySchema),
    apiGet(`/api/metrics?hours=${hours}`, metricsSchema),
    apiGet(`/api/metrics/series?hours=${hours}`, failureSeriesSchema),
    apiGet('/api/incidents?status=awaiting_approval&limit=5', incidentListSchema),
    apiGet('/api/incidents?status=manual_review&limit=5', incidentListSchema),
    apiGet('/api/audit?limit=8', auditFeedSchema),
  ]);
  const totalLabs = Object.values(labs).reduce((sum, count) => sum + count, 0);
  const header = (
    <PageHeader
      title="Overview"
      description="Simulated lab operations. Every figure is measured from committed records."
      actions={
        totalLabs > 0 && (
          <FilterGroup
            label="Window"
            options={Object.keys(WINDOWS)}
            active={windowKey}
            withAll={false}
            hrefFor={(value) => `/?window=${value ?? '24h'}`}
          />
        )
      }
    />
  );

  if (totalLabs === 0) {
    return (
      <>
        {header}
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FlaskConical className="size-5" />
          </span>
          <CardTitle>No labs yet</CardTitle>
          <CardDescription className="max-w-md text-sm">
            Run the simulated training-event scenario: 40 labs, a burst of 12 timeouts on one
            dependency, and a few unrelated failures.
          </CardDescription>
          {params.demo === 'unavailable' && (
            <p className="text-sm text-danger">The demo scenario is not enabled on this API.</p>
          )}
          <form action={runDemoScenario}>
            <Button type="submit">
              <Play className="size-4" />
              Run demo scenario
            </Button>
          </form>
        </Card>
      </>
    );
  }

  const now = metrics.incidents.byStatusNow;
  const active = ACTIVE.reduce((sum, status) => sum + (now[status] ?? 0), 0);
  const recovery = metrics.recovery.byStatus;
  const blocked = (recovery.rejected_by_policy ?? 0) + (recovery.blocked ?? 0);
  const attention = [...awaiting, ...review];

  return (
    <>
      {header}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiTile
          label="Active incidents"
          value={active}
          caption={`${now.resolved ?? 0} resolved`}
          icon={Siren}
          tone={active > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          label="Awaiting approval"
          value={now.awaiting_approval ?? 0}
          caption={(now.awaiting_approval ?? 0) > 0 ? 'needs an operator decision' : 'nothing waiting'}
          icon={UserCheck}
          tone={(now.awaiting_approval ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <KpiTile
          label="Failed labs"
          value={labs.failed ?? 0}
          caption={`of ${totalLabs} simulated labs`}
          icon={FlaskConical}
          tone={(labs.failed ?? 0) > 0 ? 'danger' : 'success'}
        />
        <KpiTile
          label="First event to incident"
          value={formatDuration(metrics.incidents.timeToIdentify.p50Ms)}
          caption={p95Caption(metrics.incidents.timeToIdentify, 'incidents')}
          icon={Timer}
          tone="info"
        />
        <KpiTile
          label="Approval to verified"
          value={formatDuration(metrics.recovery.approvalToVerified.p50Ms)}
          caption={p95Caption(metrics.recovery.approvalToVerified, 'recoveries')}
          icon={ShieldCheck}
          tone="success"
        />
        <KpiTile
          label="Blocked by policy"
          value={blocked}
          caption="refused by deterministic rules"
          icon={ShieldX}
          tone={blocked > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Failures over time</CardTitle>
            <CardDescription>
              By when each failure happened, stacked by category. Received in the last {windowKey}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {timeline.failures.bucketMs === null ? (
              <EmptyState icon={FlaskConical} title="No failures in this window" />
            ) : (
              <FailureTimeline series={timeline.failures} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Labs by state</CardTitle>
            <CardDescription>{totalLabs} simulated labs by state</CardDescription>
          </CardHeader>
          <CardContent>
            <LabsDonut counts={labs} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Failures by category</CardTitle>
            <CardDescription>Normalised categories, never raw error text.</CardDescription>
          </CardHeader>
          <CardContent>
            {ranked(timeline.failures.totals).length === 0 ? (
              <p className="text-sm text-muted-foreground">No failures in this window.</p>
            ) : (
              <BarList items={ranked(timeline.failures.totals)} colourFor={colourFor} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recovery outcomes</CardTitle>
            <CardDescription>Every proposed action, by where it ended.</CardDescription>
          </CardHeader>
          <CardContent>
            {ranked(recovery).length === 0 ? (
              <p className="text-sm text-muted-foreground">No recovery actions yet.</p>
            ) : (
              <BarList items={ranked(recovery)} colourFor={(key) => OUTCOME_COLOURS[key] ?? 'var(--info)'} />
            )}
          </CardContent>
        </Card>
        <PipelineCard metrics={metrics} windowKey={windowKey} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>
              Waiting on a human: approvals and manual reviews.{' '}
              <Link href="/incidents" className="hover:text-foreground hover:underline">
                All incidents
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <EmptyState icon={UserCheck} title="Nothing needs a decision" />
            ) : (
              <ul className="divide-y">
                {attention.map((incident) => (
                  <li key={incident.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={`/incidents/${incident.id}`} className="block truncate text-sm font-medium hover:underline">
                        {incident.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {incident.labCount} labs · first seen {formatDateTime(incident.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={incident.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              <Link href="/audit" className="hover:text-foreground hover:underline">
                Full audit trail
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {activity.map((entry) => (
                <li key={entry.seq} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <span className="truncate">
                    {humanise(entry.action)} <span className="text-muted-foreground">· {entry.outcome}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

const p50AndP95 = (summary: Duration) => `${formatDuration(summary.p50Ms)} / ${formatDuration(summary.p95Ms)}`;

// The supporting figures behind the tiles. Every one is computed by the API
// from committed rows; an unmeasured duration shows a dash rather than zero.
function PipelineCard({ metrics, windowKey }: { metrics: Metrics; windowKey: string }) {
  const correlate = metrics.queues.find((queue) => queue.queue === 'correlate');
  const ai = metrics.investigations.byStatus;
  const recovery = metrics.recovery.byStatus;
  const rows: [string, string][] = [
    ['Events received', String(metrics.events.received)],
    ['Incidents created', String(metrics.incidents.created)],
    ['Correlation run (p50 / p95)', correlate ? p50AndP95(correlate.run) : '—'],
    ['Jobs waiting or running', String(metrics.queues.reduce((sum, queue) => sum + queue.depth, 0))],
    ['Job retries', String(metrics.queues.reduce((sum, queue) => sum + queue.retries, 0))],
    ['Investigations completed / failed', `${ai.completed ?? 0} / ${ai.error ?? 0}`],
    ['Model latency (p50 / p95)', p50AndP95(metrics.investigations.latency)],
    ['Recoveries succeeded / failed', `${recovery.succeeded ?? 0} / ${recovery.failed ?? 0}`],
    ['Approval to verified (p50 / p95)', p50AndP95(metrics.recovery.approvalToVerified)],
    ['Oldest open transaction', formatDuration(metrics.oldestOpenTransactionMs)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline health</CardTitle>
        <CardDescription>Last {windowKey}, measured from committed rows of this simulated run</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
