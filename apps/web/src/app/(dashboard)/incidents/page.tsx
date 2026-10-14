import Link from 'next/link';
import { LiveRefresh } from '@/components/live-refresh';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { formatDateTime, formatScore, humanise } from '@/lib/format';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, incidentQuery } from '@/lib/queries';
import { incidentListSchema } from '@/lib/schemas';

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
  const filter = (active: boolean) => (active ? 'font-semibold' : 'text-muted-foreground hover:underline');

  return (
    <div className="space-y-4">
      <LiveRefresh />
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={link({ status: undefined, cursor: undefined })} className={filter(!params.status)}>
          all
        </Link>
        {INCIDENT_STATUSES.map((status) => (
          <Link key={status} href={link({ status, cursor: undefined })} className={filter(params.status === status)}>
            {humanise(status)}
          </Link>
        ))}
        <span className="text-muted-foreground">|</span>
        {INCIDENT_SEVERITIES.map((severity) => (
          <Link key={severity} href={link({ severity, cursor: undefined })} className={filter(params.severity === severity)}>
            {severity}
          </Link>
        ))}
      </div>

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
          {incidents.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No incidents match. Run the demo scenario from the overview.
              </TableCell>
            </TableRow>
          )}
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
              <TableCell className="text-right">{incident.labCount}</TableCell>
              <TableCell className="text-right">{formatScore(incident.correlationStrength)}</TableCell>
              <TableCell>{formatDateTime(incident.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {nextCursor && (
        <Link href={link({ cursor: nextCursor })} className="text-sm hover:underline">
          Next page
        </Link>
      )}
    </div>
  );
}
