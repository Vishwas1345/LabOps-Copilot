import { Bot, Check, Cpu, FileSearch, Lightbulb, ShieldCheck, Sparkles, Stethoscope, User, X } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfidenceGauge } from '@/components/incident/confidence-gauge';
import { ExpiryCountdown } from '@/components/incident/expiry-countdown';
import { FlowStepper } from '@/components/incident/flow-stepper';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet, apiRequest } from '@/lib/api';
import { formatDateTime, formatScore, humanise, noticeFor, summariseStates } from '@/lib/format';
import { flowSteps } from '@/lib/investigation-flow';
import { isId } from '@/lib/queries';
import type { AuditEntry, Investigation, PolicyDecision, RecoveryAction } from '@/lib/schemas';
import {
  incidentAuditSchema,
  incidentDetailSchema,
  investigationsSchema,
  recoveryActionsSchema,
} from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { decide, investigate } from './actions';

const evidenceAnchor = (id: string) => `ev-${id}`;

/** What a citation shows: the lab, when, and the event text. */
interface CitedEvent {
  lab: string;
  at: string;
  text: string;
}

const VISIBLE_CITATIONS = 3;

function Citation({ id, events }: { id: string; events: Map<string, CitedEvent> }) {
  const event = events.get(id);
  return (
    <a
      href={`#${evidenceAnchor(id)}`}
      className="block rounded-md border-l-2 border-info bg-muted/50 px-3 py-1.5 transition-colors hover:bg-info-bg"
    >
      {event ? (
        <>
          <span className="flex justify-between gap-2 font-mono text-xs text-foreground">
            <span className="truncate">{event.lab}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{event.at}</span>
          </span>
          <span className="text-muted-foreground">{event.text}</span>
        </>
      ) : (
        <span className="font-mono text-xs text-muted-foreground">{id}</span>
      )}
    </a>
  );
}

function Decisions({ decisions }: { decisions: PolicyDecision[] }) {
  return (
    <ol className="space-y-1.5 text-xs">
      {decisions.map((d, index) => (
        <li
          key={d.step}
          className={cn(
            'animate-rise flex gap-2 rounded-md px-2 py-1.5',
            d.passed ? 'text-muted-foreground' : 'bg-danger-bg font-medium text-danger',
          )}
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <span
            className={cn(
              'mt-px flex size-4 shrink-0 items-center justify-center rounded-full',
              d.passed ? 'bg-success-bg text-success' : 'bg-danger text-card',
            )}
          >
            {d.passed ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
          </span>
          <span>
            <span className="sr-only">{d.passed ? 'passed' : 'failed'} </span>
            {humanise(d.step)}: {d.reason}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Check; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {Icon && <Icon className="size-3.5" />}
        {title}
      </p>
      {children}
    </div>
  );
}

// Citations link to the cited event in the evidence list below, which flashes
// on arrival. Only the incident's own events resolve, so a citation cannot
// point outside the incident.
function EvidenceList({ title, ids, events }: { title: string; ids: string[]; events: Map<string, CitedEvent> }) {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, VISIBLE_CITATIONS);
  const rest = ids.slice(VISIBLE_CITATIONS);
  return (
    <div className="space-y-1.5">
      <p className="font-medium">{title}</p>
      <ul className="space-y-1">
        {shown.map((id) => (
          <li key={id}>
            <Citation id={id} events={events} />
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-info select-none hover:underline">
            <span className="group-open:hidden">Show {rest.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="mt-1 space-y-1">
            {rest.map((id) => (
              <li key={id}>
                <Citation id={id} events={events} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function InvestigationCard({
  investigation,
  events,
}: {
  investigation: Investigation;
  events: Map<string, CitedEvent>;
}) {
  const both = investigation.evidenceFor.length > 0 && investigation.evidenceAgainst.length > 0;
  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader className="border-b bg-gradient-to-r from-info-bg/60 to-transparent">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-info" />
          AI investigation <StatusBadge status={investigation.status} />
        </CardTitle>
        <CardDescription>
          A proposal from the model, judged by policy and a human. It never acts on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-4 text-sm">
        {investigation.failure && (
          <Alert variant="destructive">
            The model call failed ({humanise(investigation.failure)}). Nothing was changed.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="space-y-2">
            {investigation.candidateCause && (
              <p className="text-base font-medium">Likely cause: {investigation.candidateCause}</p>
            )}
            {investigation.outcome && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{humanise(investigation.outcome)}:</span>{' '}
                {investigation.summary}
              </p>
            )}
          </div>
          <ConfidenceGauge confidence={investigation.confidence} />
        </div>
        <div className={cn('grid gap-4', both && 'md:grid-cols-2')}>
          <EvidenceList title="Evidence for" ids={investigation.evidenceFor} events={events} />
          <EvidenceList title="Evidence against" ids={investigation.evidenceAgainst} events={events} />
        </div>
        {investigation.missingEvidence.length > 0 && (
          <Section title="Missing evidence" icon={FileSearch}>
            <ul className="flex flex-wrap gap-1.5">
              {investigation.missingEvidence.map((item) => (
                <li key={item} className="rounded-full border border-warning-border bg-warning-bg px-2.5 py-0.5 text-xs text-warning">
                  {item}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {investigation.diagnosticChecks.length > 0 && (
          <Section title="Checks worth running" icon={Stethoscope}>
            <ol className="space-y-1">
              {investigation.diagnosticChecks.map((item, index) => (
                <li key={item} className="flex gap-2 text-muted-foreground">
                  <span className="font-mono text-xs text-foreground tabular-nums">{index + 1}.</span>
                  {item}
                </li>
              ))}
            </ol>
          </Section>
        )}
        {investigation.recommendedAction && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <Lightbulb className="size-4 text-warning" />
            <span>Recommended:</span>
            <span className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">{investigation.recommendedAction}</span>
            <span className="text-muted-foreground">on {investigation.targetLabIds.length} lab(s)</span>
          </div>
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
    <Card className="animate-rise">
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
              'animate-rise rounded-lg border px-3 py-2',
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
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-info-border bg-info-bg/50 px-3 py-3">
            <div className="mr-auto">
              <p className="font-medium">Your decision</p>
              <ExpiryCountdown expiresAt={action.expiresAt} />
            </div>
            <form action={decide.bind(null, incidentId, action.id, 'reject')}>
              <Button type="submit" variant="outline">
                Reject
              </Button>
            </form>
            <form action={decide.bind(null, incidentId, action.id, 'approve')}>
              <Button type="submit">Approve</Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="animate-rise rounded-xl border bg-card px-4 py-3 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// Who acted on each audit step: the operator, the background worker, or the system.
const ACTOR_ICON = { human: User, worker: Cpu, system: Bot } as const;

function TimelineEntry({ entry, last }: { entry: AuditEntry; last: boolean }) {
  const Icon = ACTOR_ICON[entry.actorType as keyof typeof ACTOR_ICON] ?? Bot;
  const refused = /rejected|blocked|failed|error/.test(entry.outcome);
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span aria-hidden className="absolute top-7 bottom-0 left-3 w-px bg-border" />}
      <span
        className={cn(
          'relative flex size-6 shrink-0 items-center justify-center rounded-full border',
          entry.actorType === 'human' ? 'border-info-border bg-info-bg text-info' : 'bg-muted text-muted-foreground',
          refused && 'border-danger-border bg-danger-bg text-danger',
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm">
          {humanise(entry.action)} · {entry.outcome} · {entry.actorType}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">{formatDateTime(entry.createdAt)}</p>
      </div>
    </li>
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
  const labOfEvent = new Map(incident.labs.map((lab) => [lab.eventId, lab.labId]));
  const events = new Map<string, CitedEvent>(
    incident.events.map((event) => [
      event.id,
      {
        lab: labOfEvent.get(event.id) ?? 'unknown lab',
        at: formatDateTime(event.occurredAt),
        text: `${event.errorCategory}: ${event.message}`,
      },
    ]),
  );
  const cited = new Set([...(latest?.evidenceFor ?? []), ...(latest?.evidenceAgainst ?? [])]);

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

      <Card>
        <CardHeader>
          <CardTitle>From investigation to recovery</CardTitle>
          <CardDescription>
            The model proposes, deterministic policy decides, an operator approves, and only verification resolves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FlowStepper steps={flowSteps(latest, actions[0])} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {latest ? (
            <InvestigationCard investigation={latest} events={events} />
          ) : (
            canInvestigate && (
              <Card className="border-dashed">
                <CardContent className="flex items-center gap-4 pt-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-bg text-info">
                    <Sparkles className="size-5" />
                  </span>
                  <p className="text-sm text-muted-foreground">
                    No investigation yet. <span className="text-foreground">Investigate</span> asks the AI analyst
                    for a likely cause over this incident&apos;s own, redacted evidence. It can only suggest.
                  </p>
                </CardContent>
              </Card>
            )
          )}
          {actions.map((action) => (
            <ActionCard key={action.id} incidentId={incident.id} action={action} />
          ))}

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
                      <th className="h-9 w-40 px-3 text-right font-medium">Correlation strength</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {incident.labs.map((lab) => (
                      <tr key={lab.labId} className="border-b transition-colors hover:bg-muted/40">
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{lab.labId}</td>
                        <td className="px-3 py-2 text-muted-foreground">{lab.reason}</td>
                        <td className="px-3 py-2">
                          <span className="flex items-center justify-end gap-2">
                            {lab.signalScore !== null && (
                              <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="animate-grow-x block h-full rounded-full bg-info"
                                  style={{ width: `${Math.round(lab.signalScore * 100)}%` }}
                                />
                              </span>
                            )}
                            <span className="w-8 text-right tabular-nums">{formatScore(lab.signalScore)}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evidence</CardTitle>
              <CardDescription>
                The failure events that put each lab here (redacted at ingestion). Events the AI cited are marked.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-0.5 text-sm">
              {incident.events.map((event) => (
                <div
                  key={event.id}
                  id={evidenceAnchor(event.id)}
                  className="evidence-row flex gap-3 rounded-md px-2 py-1"
                >
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(event.occurredAt)}
                  </span>
                  <span className="shrink-0 font-mono text-xs">{event.errorCategory}</span>
                  <span className="truncate text-muted-foreground">{event.message}</span>
                  {cited.has(event.id) && (
                    <span className="ml-auto shrink-0 rounded-full bg-info-bg px-2 text-xs text-info">cited</span>
                  )}
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
            <ol>
              {audit.map((entry, index) => (
                <TimelineEntry key={entry.seq} entry={entry} last={index === audit.length - 1} />
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
