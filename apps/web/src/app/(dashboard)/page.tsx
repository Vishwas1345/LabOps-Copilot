import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api';
import { formatDateTime, humanise } from '@/lib/format';
import { auditFeedSchema, incidentListSchema, jobSummarySchema, labSummarySchema } from '@/lib/schemas';
import { runDemoScenario } from './demo-action';

const LAB_ORDER = ['provisioning', 'ready', 'failed', 'recovering', 'stopped'];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const [{ data: labs }, { data: jobs }, { data: incidents }, { data: activity }, { demo }] =
    await Promise.all([
      apiGet('/api/labs/summary', labSummarySchema),
      apiGet('/api/jobs/summary', jobSummarySchema),
      apiGet('/api/incidents?limit=10', incidentListSchema),
      apiGet('/api/audit?limit=8', auditFeedSchema),
      searchParams,
    ]);
  const totalLabs = Object.values(labs).reduce((sum, count) => sum + count, 0);

  if (totalLabs === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No labs yet</CardTitle>
          <CardDescription>
            Run the simulated training-event scenario: 40 labs, a burst of 12 timeouts on one
            dependency, and a few unrelated failures.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {demo === 'unavailable' && (
            <p className="mb-3 text-sm text-destructive">The demo scenario is not enabled on this API.</p>
          )}
          <form action={runDemoScenario}>
            <Button type="submit">Run demo scenario</Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
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
  );
}
