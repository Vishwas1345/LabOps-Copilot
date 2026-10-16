import { ChevronRight, Siren } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { FilterGroup } from '@/components/filter-group';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { formatDateTime, formatScore } from '@/lib/format';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, incidentQuery } from '@/lib/queries';
import { incidentListSchema } from '@/lib/schemas';
import { cn } from '@/lib/utils';

// Severity at a glance down the left edge, matching the severity badge colours.
const SEVERITY_ACCENT: Record<string, string> = {
  high: 'border-l-danger',
  medium: 'border-l-warning',
  low: 'border-l-border',
};

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const { data: incidents, nextCursor } = await apiGet(
    `/api/incidents?${incidentQuery(params)}`,
    incidentListSchema,
  );
  const link = (change: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { status: params.status, severity: params.severity, ...change };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    return `/incidents?${next}`;
  };

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Failures grouped by deterministic correlation. Each one explains why its labs belong together."
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <FilterGroup
          label="Status"
          options={INCIDENT_STATUSES}
          active={params.status}
          hrefFor={(status) => link({ status, cursor: undefined })}
        />
        <FilterGroup
          label="Severity"
          options={INCIDENT_SEVERITIES}
          active={params.severity}
          hrefFor={(severity) => link({ severity, cursor: undefined })}
        />
      </div>

      {incidents.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-sm">
          <EmptyState icon={Siren} title="No incidents match" hint="Change the filters, or run the demo scenario from the overview." />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Incident</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Labs</TableHead>
              <TableHead className="text-right">Correlation strength</TableHead>
              <TableHead>First seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.map((incident) => (
              <TableRow key={incident.id} className={cn('border-l-2', SEVERITY_ACCENT[incident.severity] ?? 'border-l-transparent')}>
                <TableCell>
                  <Link href={`/incidents/${incident.id}`} className="font-medium hover:underline">
                    {incident.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={incident.severity} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={incident.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{incident.labCount}</TableCell>
                <TableCell>
                  <span className="flex items-center justify-end gap-2">
                    {incident.correlationStrength !== null && (
                      <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                        <span
                          className="animate-grow-x block h-full rounded-full bg-info"
                          style={{ width: `${Math.round(incident.correlationStrength * 100)}%` }}
                        />
                      </span>
                    )}
                    <span className="w-8 text-right tabular-nums">{formatScore(incident.correlationStrength)}</span>
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(incident.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {nextCursor && (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href={link({ cursor: nextCursor })}>
              Next page <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}
