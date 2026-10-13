---
name: background-job
description: Use when adding a BullMQ queue, job handler or worker. Covers stable jobIds derived from idempotency keys, bounded retries with backoff, crash recovery reconciliation, trace-context propagation into job payloads, and keeping long work out of the HTTP request lifecycle.
---

# Adding or changing a background job

## Preconditions

Read `CLAUDE.md §4` (boundaries) and `CLAUDE.md §11` (API endpoint recipe).
If a job is triggered by an HTTP request, the endpoint must return `202` with
the job id — never await the work.

## Where things go

```
apps/api/src/jobs/
  queues.ts       queue names, payload types, enqueue helpers
  worker.ts       worker bootstrap
  handlers/<name>.ts
```

`src/index.ts` boots the API. A separate entrypoint boots the worker. **The
worker never serves HTTP.**

## Procedure

1. **Define the payload as a type.** Not `any`, not an inline object literal.

   ```ts
   export interface CorrelateJob {
     incidentId: string;
     spanContext: TraceContext;
   }
   ```

2. **Derive `jobId` from the idempotency key.** This is what collapses
   duplicate enqueues into one job instead of racing.

   ```ts
   await queue.add('correlate', payload, {
     jobId: `correlate:${payload.incidentId}`,
     attempts: 3,
     backoff: { type: 'exponential', delay: 1000 },
   });
   ```

   Use a stable prefix + key. Never a random id — that defeats the purpose.

3. **Propagate trace context into the payload.** One incident must resolve to
   one trace across processes and minutes. See `CLAUDE.md §9` and the
   `observability` skill.

4. **Make the handler idempotent.** Assume it will run twice. Read current state
   inside a transaction, check whether the effect already exists, and return
   the prior result instead of re-applying.

5. **Persist job state in Postgres.** `JobExecution` mirrors queue state. If
   Redis is flushed, business history survives and the worker reconciles
   orphaned `running` rows on startup.

6. **Fail loudly but bounded.** After `attempts` is exhausted: mark the row
   `failed`, move the incident to `manual_review`, write an audit entry with a
   redacted error summary. Never swallow an error into a log line only.

## Error handling rules

- Redact before logging. An error summary in the DB is redacted, not the raw
  error.
- Retriable vs permanent: a Zod failure from an LLM is **not** retriable — it is
  a deterministic rejection and must mark the investigation `error` and leave
  incident state untouched. See `CLAUDE.md §5`.
- A job must never hold a database transaction open while calling an external
  service.

## Mandatory negative test

- Enqueue the same logical job twice → exactly one effect, one audit entry
- Make the handler throw → retries, then `failed`, incident goes to
  `manual_review`
- Kill the worker mid-job → after restart the row is reconciled, not stuck in
  `running`

## Verify

```bash
npm run build -w @labops/api
```

Run the worker against real Redis and confirm the job actually executes. A unit
test with a mocked queue does not prove this.
