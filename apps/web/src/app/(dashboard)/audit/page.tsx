import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { formatDateTime, humanise } from '@/lib/format';
import { auditFeedSchema } from '@/lib/schemas';

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const query = cursor && /^\d{1,19}$/.test(cursor) ? `&cursor=${cursor}` : '';
  const { data: entries, nextCursor } = await apiGet(`/api/audit?limit=50${query}`, auditFeedSchema);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Append-only: every state change, decision and sign-in, newest first.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.seq}>
              <TableCell className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TableCell>
              <TableCell>{humanise(entry.action)}</TableCell>
              <TableCell>{entry.outcome}</TableCell>
              <TableCell>
                {entry.actorType} · <span className="font-mono text-xs">{entry.actorId}</span>
              </TableCell>
              <TableCell>
                {entry.targetType === 'incident' ? (
                  <Link href={`/incidents/${entry.targetId}`} className="font-mono text-xs hover:underline">
                    {entry.targetId}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">
                    {entry.targetType}:{entry.targetId}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {nextCursor && (
        <Link href={`/audit?cursor=${nextCursor}`} className="text-sm hover:underline">
          Older entries
        </Link>
      )}
    </div>
  );
}
