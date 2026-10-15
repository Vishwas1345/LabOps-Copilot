import { ChevronRight, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { formatDateTime, humanise } from '@/lib/format';
import { auditFeedSchema } from '@/lib/schemas';

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const query = cursor && /^\d{1,19}$/.test(cursor) ? `&cursor=${cursor}` : '';
  const { data: entries, nextCursor } = await apiGet(`/api/audit?limit=50${query}`, auditFeedSchema);

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Append-only: every state change, decision and sign-in, newest first."
      />
      {entries.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-sm">
          <EmptyState icon={ScrollText} title="Nothing recorded yet" />
        </div>
      ) : (
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
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(entry.createdAt)}</TableCell>
                <TableCell className="font-medium">{humanise(entry.action)}</TableCell>
                <TableCell>{entry.outcome}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{entry.actorType}</Badge>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{entry.actorId}</span>
                </TableCell>
                <TableCell>
                  {entry.targetType === 'incident' ? (
                    <Link href={`/incidents/${entry.targetId}`} className="font-mono text-xs hover:underline">
                      {entry.targetId}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {entry.targetType}:{entry.targetId}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {nextCursor && (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href={`/audit?cursor=${nextCursor}`}>
              Older entries <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}
