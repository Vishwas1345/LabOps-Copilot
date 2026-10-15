---
name: background-job
description: Use when adding a BullMQ queue, job handler or worker. Covers outbox job rows, stable jobIds derived from idempotency keys, bounded retries with backoff, crash recovery reconciliation, trace-context propagation through the job row, and keeping long work out of the HTTP request lifecycle.
---

# Adding or changing a background job

## Preconditions

Read `CLAUDE.md §4` (boundaries) and `CLAUDE.md §11` (API endpoint recipe).
If a job is triggered by an HTTP request, the endpoint must return `202` with
the job id — never await the work.

## Where things go

```
apps/api/src/jobs/
  queues.ts       queue names, the JobMessage type, connections
  record.ts       recordJob (outbox row in the caller's transaction),
                  dispatchJob (send to Redis after commit)
  runner.ts       runJob: status, attempts, trace continuation, onExhausted
  reconcile.ts    re-sends stale queued/running rows (lease 2 min)
  worker.ts       creates a BullMQ worker for one queue
apps/api/src/<domain>/*.job.ts   the handlers, e.g. incidents/correlate.job.ts
apps/api/src/worker.ts           the worker entrypoint: wires handlers to jobs/
```

`src/index.ts` boots the API; `src/worker.ts` boots the worker. `jobs/` stays
generic and imports no domain module. **The worker never serves HTTP.**

## Procedure

1. **Write the job row in the caller's transaction, then dispatch.** The domain
   payload is stored on the `JobExecution` row and Zod-validated by the
   handler; the BullMQ message carries only `{ jobExecutionId, generation }`.

   ```ts
   const job = await recordJob(tx, 'investigate', investigateJobKey(id), { investigationId: id }, currentTraceparent());
   // after the transaction commits:
   await dispatchJob(job);
   ```

2. **Derive the job key from the idempotency key.** It is unique on the row and
   is the BullMQ `jobId`, so duplicate enqueues collapse into one job instead of
   racing. Use a stable prefix + key, never a random id. A repeat `recordJob`
   for the same key re-arms the row (generation + 1).

3. **Carry trace context on the row.** `recordJob` stores the traceparent and the
   runner continues it. For a step on an existing incident, pass the incident's
   own trace so one incident stays one trace. See `CLAUDE.md §9` and the
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
