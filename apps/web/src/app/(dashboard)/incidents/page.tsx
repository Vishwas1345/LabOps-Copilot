import { ChevronRight, Siren } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { formatDateTime, formatScore, humanise } from '@/lib/format';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, incidentQuery } from '@/lib/queries';
import { incidentListSchema } from '@/lib/schemas';
import { cn } from '@/lib/utils';

// Filters are links, so a filtered view is a shareable URL and the page stays
// a server component; incidentQuery drops any value outside the known sets.
function FilterGroup({
  label,
  options,
  active,
  hrefFor,
}: {
  label: string;
  options: string[];
  active: string | undefined;
  hrefFor: (value: string | undefined) => string;
}) {
  const pill = (selected: boolean) =>
    cn(
      'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap',
      selected ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
    );
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
        <Link href={hrefFor(undefined)} className={pill(!active)}>
          All
        </Link>
        {options.map((option) => (
          <Link key={option} href={hrefFor(option)} className={pill(active === option)}>
            {humanise(option)}
          </Link>
        ))}
      </div>
    </div>
  );
}

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
              <TableRow key={incident.id}>
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
                <TableCell className="text-right tabular-nums">{formatScore(incident.correlationStrength)}</TableCell>
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
