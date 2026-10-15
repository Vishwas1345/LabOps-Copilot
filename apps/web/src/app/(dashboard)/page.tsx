import { FlaskConical, Play } from 'lucide-react';
import Link from 'next/link';
import type { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api';
import { formatDateTime, formatDuration, humanise } from '@/lib/format';
import {
  auditFeedSchema,
  incidentListSchema,
  jobSummarySchema,
  labSummarySchema,
  metricsSchema,
} from '@/lib/schemas';
import { runDemoScenario } from './demo-action';

const LAB_ORDER = ['provisioning', 'ready', 'failed', 'recovering', 'stopped'];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const [{ data: labs }, { data: jobs }, { data: incidents }, { data: activity }, { data: metrics }, { demo }] =
    await Promise.all([
      apiGet('/api/labs/summary', labSummarySchema),
      apiGet('/api/jobs/summary', jobSummarySchema),
      apiGet('/api/incidents?limit=10', incidentListSchema),
      apiGet('/api/audit?limit=8', auditFeedSchema),
      apiGet('/api/metrics', metricsSchema),
      searchParams,
    ]);
  const totalLabs = Object.values(labs).reduce((sum, count) => sum + count, 0);

  if (totalLabs === 0) {
    return (
      <>
        <PageHeader title="Overview" description="Simulated lab operations, end to end." />
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FlaskConical className="size-5" />
          </span>
          <CardTitle>No labs yet</CardTitle>
          <CardDescription className="max-w-md text-sm">
            Run the simulated training-event scenario: 40 labs, a burst of 12 timeouts on one
            dependency, and a few unrelated failures.
          </CardDescription>
          {demo === 'unavailable' && (
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

  return (
    <>
      <PageHeader title="Overview" description="Simulated lab operations, end to end." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Labs</CardTitle>
            <CardDescription>{totalLabs} simulated labs by state</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-5 gap-2 text-center">
            {LAB_ORDER.map((status) => (
              <div key={status}>
                <div className="text-2xl font-semibold">{labs[status] ?? 0}</div>
                <div className="text-xs text-muted-foreground">{status}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job queues</CardTitle>
            <CardDescription>From the Postgres mirror of every queued job</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {jobs.length === 0 && <p className="text-muted-foreground">No jobs yet.</p>}
            {jobs.map((row) => (
              <div key={`${row.queue}-${row.status}`} className="flex justify-between">
                <span>
                  {row.queue} · {row.status}
                </span>
                <span className="font-medium">{row.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent incidents</CardTitle>
            <CardDescription>
              The {incidents.length} newest.{' '}
              <Link href="/incidents?status=open" className="hover:underline">
                All open incidents
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {incidents.length === 0 && <p className="text-muted-foreground">No incidents yet.</p>}
            {incidents.map((incident) => (
              <Link key={incident.id} href={`/incidents/${incident.id}`} className="flex items-center justify-between gap-2 hover:underline">
                <span className="truncate">{incident.title}</span>
                <StatusBadge status={incident.status} />
              </Link>
            ))}
          </CardContent>
        </Card>

        <MetricsCard metrics={metrics} />

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              <Link href="/audit" className="hover:underline">
                Full audit trail
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {activity.map((entry) => (
              <div key={entry.seq} className="flex justify-between gap-2">
                <span className="truncate">
                  {humanise(entry.action)} · {entry.outcome}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

type Metrics = z.infer<typeof metricsSchema>['data'];

const p50AndP95 = (summary: Metrics['incidents']['timeToIdentify']) =>
  `${formatDuration(summary.p50Ms)} / ${formatDuration(summary.p95Ms)}`;

// Every figure is computed by the API from committed rows; nothing here is
// estimated, and an unmeasured duration shows a dash rather than zero.
function MetricsCard({ metrics }: { metrics: Metrics }) {
  const correlate = metrics.queues.find((queue) => queue.queue === 'correlate');
  const ai = metrics.investigations.byStatus;
  const recovery = metrics.recovery.byStatus;
  const rows: [string, string][] = [
    ['Events received', String(metrics.events.received)],
    ['Incidents created', String(metrics.incidents.created)],
    ['First event to incident (p50 / p95)', p50AndP95(metrics.incidents.timeToIdentify)],
    ['Correlation run (p50 / p95)', correlate ? p50AndP95(correlate.run) : '—'],
    ['Jobs waiting or running', String(metrics.queues.reduce((sum, queue) => sum + queue.depth, 0))],
    ['Job retries', String(metrics.queues.reduce((sum, queue) => sum + queue.retries, 0))],
    ['Investigations completed / failed', `${ai.completed ?? 0} / ${ai.error ?? 0}`],
    ['Model latency (p50 / p95)', p50AndP95(metrics.investigations.latency)],
    ['Recoveries succeeded / failed', `${recovery.succeeded ?? 0} / ${recovery.failed ?? 0}`],
    ['Blocked by policy', String((recovery.rejected_by_policy ?? 0) + (recovery.blocked ?? 0))],
    ['Approval to verified (p50 / p95)', p50AndP95(metrics.recovery.approvalToVerified)],
    ['Oldest open transaction', formatDuration(metrics.oldestOpenTransactionMs)],
  ];
  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Metrics</CardTitle>
        <CardDescription>
          Last {metrics.window.hours} h, measured from committed rows of this simulated run
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
