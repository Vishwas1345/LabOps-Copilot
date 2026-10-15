import { Bot, Check, ShieldCheck, Sparkles, X } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet, apiRequest } from '@/lib/api';
import {
  formatConfidence,
  formatDateTime,
  formatScore,
  humanise,
  noticeFor,
  summariseStates,
} from '@/lib/format';
import { isId } from '@/lib/queries';
import type { Investigation, PolicyDecision, RecoveryAction } from '@/lib/schemas';
import {
  incidentAuditSchema,
  incidentDetailSchema,
  investigationsSchema,
  recoveryActionsSchema,
} from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { decide, investigate } from './actions';

function Decisions({ decisions }: { decisions: PolicyDecision[] }) {
  return (
    <ol className="space-y-1 text-xs">
      {decisions.map((d) => (
        <li key={d.step} className={cn('flex gap-1.5', d.passed ? 'text-muted-foreground' : 'font-medium text-danger')}>
          {d.passed ? <Check className="mt-px size-3.5 shrink-0" /> : <X className="mt-px size-3.5 shrink-0" />}
          <span>
            <span className="sr-only">{d.passed ? 'passed' : 'failed'} </span>
            {humanise(d.step)}: {d.reason}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  );
}

function EvidenceList({ title, ids, messages }: { title: string; ids: string[]; messages: Map<string, string> }) {
  if (ids.length === 0) return null;
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
        {ids.map((id) => (
          <li key={id}>{messages.get(id) ?? id}</li>
        ))}
      </ul>
    </div>
  );
}

// Evidence is cited by event id; the page shows the event it names, from the
// incident's own evidence, so a citation cannot point outside the incident.
function InvestigationCard({
  investigation,
  messages,
}: {
  investigation: Investigation;
  messages: Map<string, string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-info" />
          AI investigation <StatusBadge status={investigation.status} />
        </CardTitle>
        <CardDescription>
          A proposal from the model, judged by policy and a human. It never acts on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
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
        <div className="grid gap-3 sm:grid-cols-2">
          {investigation.candidateCause && (
            <p className="rounded-lg bg-muted px-3 py-2">Likely cause: {investigation.candidateCause}</p>
          )}
          <p className="rounded-lg bg-muted px-3 py-2">Confidence: {formatConfidence(investigation.confidence)}</p>
        </div>
        <EvidenceList title="Evidence for" ids={investigation.evidenceFor} messages={messages} />
        <EvidenceList title="Evidence against" ids={investigation.evidenceAgainst} messages={messages} />
        {investigation.missingEvidence.length > 0 && (
          <div>
            <p className="font-medium">Missing evidence</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {investigation.missingEvidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {investigation.diagnosticChecks.length > 0 && (
          <div>
            <p className="font-medium">Checks worth running</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {investigation.diagnosticChecks.map((item) => (
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
          <Alert variant="warning">
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
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <span className="font-mono text-sm">{action.actionType}</span>
          <StatusBadge status={action.status} />
        </CardTitle>
        <CardDescription>
          {action.targetIds.length} target(s) · proposed {formatDateTime(action.createdAt)}
          {action.approvedBy && ` · approved ${formatDateTime(action.approvedAt)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {action.targetIds.length > 0 && (
          <p className="text-xs">
            Targets: <span className="font-mono text-muted-foreground">{action.targetIds.join(', ')}</span>
          </p>
        )}
        {action.blockedAt && (
          <Alert variant="destructive">Blocked by policy at the {humanise(action.blockedAt)} step.</Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Section title="Policy at proposal">
            <Decisions decisions={action.policyDecisions} />
          </Section>
          {action.result?.executionDecisions && (
            <Section title="Policy re-checked at execution">
              <Decisions decisions={action.result.executionDecisions} />
            </Section>
          )}
        </div>
        {verification && (
          <div
            className={cn(
              'rounded-lg border px-3 py-2',
              verification.passed ? 'border-success-border bg-success-bg' : 'border-danger-border bg-danger-bg',
            )}
          >
            <p className={cn('font-medium', verification.passed ? 'text-success' : 'text-danger')}>
              Verification: {verification.passed ? 'passed, every lab ready' : 'failed'}
            </p>
            <p className="text-xs text-muted-foreground">
              Before: {summariseStates(action.result?.before)} · After: {summariseStates(verification.after)}
            </p>
            {verification.notReady && verification.notReady.length > 0 && (
              <p className="text-xs text-muted-foreground">Not ready: {verification.notReady.length} lab(s)</p>
            )}
          </div>
        )}
        {action.status === 'awaiting_approval' && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
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

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
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
    <>
      <PageHeader
        title={incident.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={incident.status} />
            <StatusBadge status={incident.severity} />
            <span>{incident.labCount} labs</span>
          </span>
        }
        actions={
          canInvestigate && (
            <form action={investigate.bind(null, incident.id)}>
              <Button type="submit">
                <Bot className="size-4" />
                Investigate
              </Button>
            </form>
          )
        }
      />
      {message && <Alert variant="destructive">{message}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Labs affected" value={incident.labCount} />
        <Stat label="Correlation strength" value={formatScore(incident.correlationStrength)} />
        <Stat label="First seen" value={<span className="text-sm">{formatDateTime(incident.createdAt)}</span>} />
        <Stat label="Resolved" value={<span className="text-sm">{formatDateTime(incident.resolvedAt)}</span>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Why these labs are grouped</CardTitle>
              <CardDescription>
                Deterministic scoring, never the model. {incident.correlationReason.summary}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="h-9 px-3 text-left font-medium">Lab</th>
                      <th className="h-9 px-3 text-left font-medium">Reason (recorded verbatim)</th>
                      <th className="h-9 px-3 text-right font-medium">Correlation strength</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {incident.labs.map((lab) => (
                      <tr key={lab.labId} className="border-b">
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{lab.labId}</td>
                        <td className="px-3 py-2">{lab.reason}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatScore(lab.signalScore)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {latest && (
            <InvestigationCard
              investigation={latest}
              messages={new Map(incident.events.map((event) => [event.id, `${event.errorCategory}: ${event.message}`]))}
            />
          )}
          {actions.map((action) => (
            <ActionCard key={action.id} incidentId={incident.id} action={action} />
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Evidence</CardTitle>
              <CardDescription>The failure events that put each lab here (redacted at ingestion).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {incident.events.map((event) => (
                <div key={event.id} className="flex gap-3">
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(event.occurredAt)}
                  </span>
                  <span className="shrink-0 font-mono text-xs">{event.errorCategory}</span>
                  <span className="truncate text-muted-foreground">{event.message}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-0">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>This incident&apos;s audit history, in order.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l pl-4">
              {audit.map((entry) => (
                <li key={entry.seq} className="relative">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-muted-foreground" />
                  <p className="text-sm">
                    {humanise(entry.action)} · {entry.outcome} · {entry.actorType}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">{formatDateTime(entry.createdAt)}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
