---
name: api-endpoint
description: Use when adding, changing or reviewing an HTTP endpoint in apps/api. Covers Zod validation at the boundary, the short-transaction pattern, audit writes in the same transaction, 202 + enqueue for long-running work, the shared error envelope, and the mandatory negative test.
---

# Adding or changing an API endpoint

## Preconditions

Read `CLAUDE.md §4` (architecture rules) and `CLAUDE.md §6` (data and state
rules) first. Confirm which module owns the data being exposed.

## Where things go

```
apps/api/src/modules/<feature>/
  routes.ts     HTTP surface only — validation, auth, delegate to service
  service.ts    business logic, transactions, audit writes
  schemas.ts    Zod schemas for body / params / query (events/ uses schema.ts)
```

Never put query logic in `src/app.ts`. Never import another domain's Prisma
model — import its service. See `CLAUDE.md §4`.

## Procedure

1. **Define the Zod schema before the handler.** Separate schemas for `body`,
   `params` and `query`. Use `.strict()` so unknown fields are rejected rather
   than silently dropped. Narrow enums with `z.enum([...])`, never `z.string()`.

2. **Validate, authorise, persist, enqueue, respond.** That order. No other
   sequence is acceptable.

3. **Write the transition and its audit entry in one transaction.** If the
   handler changes state, the `AuditEntry` insert is in the same
   `prisma.$transaction([...])`. Never a separate call afterwards.

4. **Long work goes to the queue.** If the work takes more than a few hundred
   milliseconds, or touches an LLM or a simulator mutation, enqueue and return
   `202` with the job id. Never `await` investigation or recovery inline.
   See the `background-job` skill.

5. **Return the shared envelope.** Success returns the resource shape wrapped
   consistently. Failure goes through the global error handler so every error
   looks the same and no stack trace reaches the client.

## Handler template

```ts
// routes.ts: HTTP only. Shape of the real proposal route.
app.post('/api/incidents/:id/recovery-proposals', async (request, reply) => {
  const { id } = incidentParams.parse(request.params);
  const body = proposalBody.parse(request.body);       // .strict() Zod schema
  const actor = actorOf(request);                       // from the session, never the body
  const proposal = await prisma
    .$transaction((tx) => proposeAction(tx, id, body, actor, options))
    .catch(mapError);                                   // domain errors -> AppError
  return reply.status(proposal.created ? 201 : 200).send({ data: { ... } });
});

// service: the state change and its audit entry commit together.
await writeAudit(tx, {
  actor,                                                // { type: 'human', id }
  action: 'recovery.proposed',
  targetType: 'recovery_action',
  targetId: action.id,
  outcome: action.status,                               // e.g. 'awaiting_approval'
  metadata: { incidentId },
});
```

Long-running work is not done here: the service writes a job row with
`recordJob(tx, ...)` and the route returns `202` with the job id after
`dispatchJob`.

## Rules that get reviewed

- No business rule decided inside the handler that a worker also needs. If both
  need it, it belongs in the service.
- Idempotency: a write endpoint carries an idempotency key. On conflict, return
  the prior result — never re-execute. See `CLAUDE.md §6`.
- List endpoints are paginated from the start. No unbounded `findMany`.
- Never return a credential, encrypted or not. See `CLAUDE.md §5`.
- Read-only endpoints still validate `params` and `query`.

## Mandatory negative test

Every endpoint ships with at least one test that proves it refuses bad input or
refuses an unauthorised call:

- body fails Zod → 4xx, no row written, no audit `success` entry
- unknown body field → rejected (because `.strict()`)
- calling the handler twice with the same idempotency key → one effect

Integration test hits the real database. See `CLAUDE.md §8`.

## Verify

```bash
npm run build -w @labops/api
```

Then update the endpoint table in `README.md` and any flow diagram in
`ARCHITECTURE.md §5` that this endpoint changes.
