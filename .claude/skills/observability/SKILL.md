---
name: observability
description: Use when adding or changing logging, tracing or metrics, and whenever a new stage is added to the incident lifecycle. Covers Pino with boundary redaction, the seven required OpenTelemetry spans, trace-context propagation across the queue boundary, and the ban on fabricated performance numbers.
---

# Adding or changing observability

## Preconditions

Read `CLAUDE.md §9`. If you are adding a stage to the incident lifecycle, this
skill is mandatory — not optional polish.

## Where things go

```
apps/api/src/observability/
  logger.ts      Pino, the key-name redaction safety net, header paths
  redact.ts      redactSecrets: walks a log object and masks secret-named keys
  tracing.ts     OpenTelemetry bootstrap (service.name), withSpan,
                 currentTraceparent, withTraceparent
  metrics.ts     shared shapes for DB-derived metrics (DurationSummary, countsFor)
```

## Logs

1. **Redact where data enters; the logger is only the net.** `logger.ts` runs
   every log object through `redactSecrets` (any depth, any casing, secret-named
   keys) and masks auth and cookie header paths. It cannot catch a secret under
   an innocuous key or inside a message string, which is why entry-point
   redaction is the control.

2. **Child loggers carry context.** Worker job lines carry `jobId`, `jobKey`,
   `queue` and `traceId` (`jobs/runner.ts`); handlers add `incidentId` where
   they know it. Fastify request lines carry the request id.

3. **Never `console.log` in backend source.** Never log a full unredacted
   payload. Error summaries are redacted before they are stored or logged.

## Traces

1. **Emit one span per lifecycle stage**, using the project's fixed names:

   ```
   event.ingest
   incident.correlate
   investigation.queue
   investigation.llm
   recovery.policy_check
   recovery.execute
   recovery.verify
   ```

2. **Propagate trace context through the job row, and rejoin the incident's
   trace.** `recordJob` stores `currentTraceparent()` on the `JobExecution` row;
   the runner continues it with `withTraceparent`. Correlation stores the trace
   an incident is born in on `Incident.traceparent`, and later steps
   (investigate, approve) start from it, so one incident is one trace even when
   an operator acts minutes later. The BullMQ message itself carries only
   `{ jobExecutionId, generation }`.

   See the `background-job` skill.

3. **Spans describe the operation, not the implementation.** No span named
   `query2`. A reviewer must be able to read the trace and understand the
   incident's path.

## Metrics

Metrics are **derived from committed Postgres rows**, not kept in process
counters: one query counts both the api and the worker, the figures survive a
restart, and they cannot disagree with the audit trail. Each module that owns a
table computes its own figures in `<module>/stats.ts`; `metrics/service.ts`
combines them for `GET /api/metrics`, and `GET /api/metrics/series` reads
`events/stats.ts` directly.

- Durations are percentiles (`percentile_cont`) over the window; one with no
  samples is `null`, never `0`.
- Compare a timestamp column with a JS `Date` as `(${since} AT TIME ZONE
  'UTC')`: Prisma binds a `Date` as `timestamptz` (#22).
- Never label with ids: the output stays a fixed size.

## The hard rule

**Metrics and demo numbers come from real runs. Never fabricate, estimate or
hardcode a performance improvement.** If a number has not been measured, it does
not go in the README, the dashboard or a commit message.

## Verify

```bash
npm run build -w @labops/api
```

Then run the full seeded scenario with `compose.tracing.yml` and confirm in
Jaeger:

- every one of the seven spans appears in one trace for one incident
- that trace spans `labops-api` and `labops-worker`
- no log line contains a credential, even when a test event carries one
- the metrics emitted are ones you actually computed
