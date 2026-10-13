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
  logger.ts      Pino, redaction, child-logger helpers
  tracing.ts     OpenTelemetry bootstrap + span helpers
  metrics.ts     counters and histograms
  context.ts     correlationId / traceId propagation
```

## Logs

1. **Redact at the serializer**, not at each call site. A forgotten
   `logger.info(payload)` must still be unable to emit a token.

   ```ts
   export const logger = pino({
     redact: {
       paths: [
         'req.headers.authorization',
         'req.headers["x-api-key"]',
         '*.token',
         '*.credential',
         '*.password',
         '*.secret',
       ],
       censor: '[redacted]',
     },
   });
   ```

2. **Child loggers carry context.** Every log line in a request or job carries
   `correlationId`, `traceId` and, where applicable, `incidentId`.

   ```ts
   const log = logger.child({
     correlationId,
     traceId,
     incidentId,
   });
   ```

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

2. **Propagate trace context through the queue.** Embed the span context in the
   BullMQ job payload and extract it in the handler, so one incident resolves to
   one trace across processes and minutes. Without this, the API trace and the
   worker trace are unrelated, which defeats the point.

   See the `background-job` skill.

3. **Spans describe the operation, not the implementation.** No span named
   `query2`. A reviewer must be able to read the trace and understand the
   incident's path.

## Metrics

Counters and histograms only for things you can actually measure:

| Metric | Type |
|---|---|
| events ingested | counter |
| candidate incidents created | counter |
| correlation duration | histogram |
| queue depth, job latency | gauge, histogram |
| AI request success/failure, latency | counter, histogram |
| recovery success/failure rate | counter |
| retry count | counter |
| time from first event to incident identification | histogram |
| time from approved action to verified outcome | histogram |

## The hard rule

**Metrics and demo numbers come from real runs. Never fabricate, estimate or
hardcode a performance improvement.** If a number has not been measured, it does
not go in the README, the dashboard or a commit message.

## Verify

```bash
npm run build -w @labops/api
```

Then run the full seeded scenario and confirm:

- every one of the seven spans appears for one incident
- one trace id spans API, queue and worker
- no log line contains a credential, even when the scenario injects one
- the metrics emitted are ones you actually computed
