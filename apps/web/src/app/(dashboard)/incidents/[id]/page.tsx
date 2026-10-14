import { notFound } from 'next/navigation';
import { LiveRefresh } from '@/components/live-refresh';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet, apiRequest } from '@/lib/api';
import {
  formatConfidence,
  formatDateTime,
  formatScore,
  humanise,
  noticeFor,
} from '@/lib/format';
import { isId } from '@/lib/queries';
import type { Investigation, PolicyDecision, RecoveryAction } from '@/lib/schemas';
import {
  incidentAuditSchema,
  incidentDetailSchema,
  investigationsSchema,
  recoveryActionsSchema,
} from '@/lib/schemas';
import { decide, investigate } from './actions';

function Decisions({ decisions }: { decisions: PolicyDecision[] }) {
  return (
    <ol className="space-y-0.5 text-xs">
      {decisions.map((d) => (
        <li key={d.step} className={d.passed ? 'text-muted-foreground' : 'font-medium text-destructive'}>
          {d.passed ? '✓' : '✗'} {humanise(d.step)}: {d.reason}
        </li>
      ))}
    </ol>
  );
}

function InvestigationCard({ investigation }: { investigation: Investigation }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          AI investigation <StatusBadge status={investigation.status} />
        </CardTitle>
        <CardDescription>
          A proposal from the model, judged by policy and a human. It never acts on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {investigation.failure && (
          <Alert variant="destructive">
            The model call failed ({humanise(investigation.failure)}). Nothing was changed.
          </Alert>
        )}
        {investigation.outcome && (
          <p>
            <span className="font-medium">{humanise(investigation.outcome)}:</span> {investigation.summary}
          </p>
        )}
        {investigation.candidateCause && <p>Likely cause: {investigation.candidateCause}</p>}
        <p>Confidence: {formatConfidence(investigation.confidence)}</p>
        {investigation.missingEvidence.length > 0 && (
          <div>
            <p className="font-medium">Missing evidence</p>
            <ul className="list-disc pl-5">
              {investigation.missingEvidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {investigation.recommendedAction && (
          <p>
            Recommended: <span className="font-mono">{investigation.recommendedAction}</span> on{' '}
            {investigation.targetLabIds.length} lab(s)
          </p>
        )}
        {investigation.droppedTargets.length > 0 && (
          <Alert>
            The model named {investigation.droppedTargets.length} lab(s) outside this incident; they
            were ignored.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function ActionCard({ incidentId, action }: { incidentId: string; action: RecoveryAction }) {
  const verification = action.verificationResult;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="font-mono text-sm">{action.actionType}</span>
          <StatusBadge status={action.status} />
        </CardTitle>
        <CardDescription>
          {action.targetIds.length} target(s) · proposed {formatDateTime(action.createdAt)}
          {action.approvedBy && ` · approved ${formatDateTime(action.approvedAt)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {action.blockedAt && (
          <Alert variant="destructive">Blocked by policy at the {humanise(action.blockedAt)} step.</Alert>
        )}
        <div>
          <p className="mb-1 font-medium">Policy at proposal</p>
          <Decisions decisions={action.policyDecisions} />
        </div>
        {action.result?.executionDecisions && (
          <div>
            <p className="mb-1 font-medium">Policy re-checked at execution</p>
            <Decisions decisions={action.result.executionDecisions} />
          </div>
        )}
        {verification && (
          <div>
            <p className="mb-1 font-medium">
              Verification: {verification.passed ? 'passed, every lab ready' : 'failed'}
            </p>
            {verification.notReady && verification.notReady.length > 0 && (
              <p className="text-xs text-muted-foreground">Not ready: {verification.notReady.length} lab(s)</p>
            )}
          </div>
        )}
        {action.status === 'awaiting_approval' && (
          <div className="flex items-center gap-2">
            <form action={decide.bind(null, incidentId, action.id, 'approve')}>
              <Button type="submit">Approve</Button>
            </form>
            <form action={decide.bind(null, incidentId, action.id, 'reject')}>
              <Button type="submit" variant="outline">
                Reject
              </Button>
            </form>
            <span className="text-xs text-muted-foreground">Expires {formatDateTime(action.expiresAt)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  if (!isId(id)) notFound();
  const found = await apiRequest(`/api/incidents/${id}`, incidentDetailSchema);
  if (!found.ok && found.status === 404) notFound();
  if (!found.ok) throw new Error(`API ${found.status} ${found.code}`);
  const incident = found.data.data;
  const [{ data: investigations }, { data: actions }, { data: audit }] = await Promise.all([
    apiGet(`/api/incidents/${id}/investigations`, investigationsSchema),
    apiGet(`/api/incidents/${id}/recovery-actions`, recoveryActionsSchema),
    apiGet(`/api/incidents/${id}/audit`, incidentAuditSchema),
  ]);
  const latest = investigations[0];
  const canInvestigate = incident.status === 'open' || incident.status === 'manual_review';
  const message = noticeFor(notice);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{incident.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={incident.status} />
            <StatusBadge status={incident.severity} />
            <span>{incident.labCount} labs</span>
            <span>· correlation strength {formatScore(incident.correlationStrength)}</span>
            <span>· first seen {formatDateTime(incident.createdAt)}</span>
            {incident.resolvedAt && <span>· resolved {formatDateTime(incident.resolvedAt)}</span>}
          </div>
        </div>
        {canInvestigate && (
          <form action={investigate.bind(null, incident.id)}>
            <Button type="submit">Investigate</Button>
          </form>
        )}
      </div>
      {message && <Alert variant="destructive">{message}</Alert>}
      <LiveRefresh incidentId={incident.id} />

      <Card>
        <CardHeader>
          <CardTitle>Why these labs are grouped</CardTitle>
          <CardDescription>
            Deterministic scoring, never the model. {incident.correlationReason.summary}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lab</TableHead>
                <TableHead>Reason (recorded verbatim)</TableHead>
                <TableHead className="text-right">Correlation strength</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incident.labs.map((lab) => (
                <TableRow key={lab.labId}>
                  <TableCell className="font-mono text-xs">{lab.labId}</TableCell>
                  <TableCell>{lab.reason}</TableCell>
                  <TableCell className="text-right">{formatScore(lab.signalScore)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {latest && <InvestigationCard investigation={latest} />}
      {actions.map((action) => (
        <ActionCard key={action.id} incidentId={incident.id} action={action} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
          <CardDescription>The failure events that put each lab here (redacted at ingestion).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {incident.events.map((event) => (
            <div key={event.id} className="flex gap-3">
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</span>
              <span className="shrink-0 font-mono text-xs">{event.errorCategory}</span>
              <span className="truncate">{event.message}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>This incident&apos;s audit history, in order.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {audit.map((entry) => (
            <div key={entry.seq} className="flex gap-3">
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
              <span>
                {humanise(entry.action)} · {entry.outcome} · {entry.actorType}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
