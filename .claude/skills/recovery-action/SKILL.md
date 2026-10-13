---
name: recovery-action
description: Use when adding a new executable recovery action, changing policy evaluation, or changing approval and execution flow. Covers the allow-list enum, the fixed seven-step policy order, revalidation at execution time, idempotency, and verification-gated incident resolution. Highest-risk surface in the repo.
---

# Adding an executable recovery action

## Preconditions

Read `CLAUDE.md §6` (recovery actions) and `ARCHITECTURE.md §10` (safety model).
This is the highest-risk surface in the repository. A mistake here is a real
side effect on real infrastructure.

## The one rule

**There is no generic "run this" path.** Actions are a closed enum. If you find
yourself wanting a parameter that reaches a shell or an SDK call with
model-supplied input, stop — that action does not exist and must not be built.

## Where things go

```
apps/api/src/policies/      allow-list, preconditions, retry limits, cooldown
apps/api/src/approvals/     approve/reject, expiry, revalidation
apps/api/src/recovery/      simulated execution + post-action verification
```

## Procedure

1. **Add the action to the enum**, and in the same change:
   - add it to the allow-list table in `ARCHITECTURE.md §10`
   - add it to the policy engine
   - add it to the closed enum in the AI output schema (`ai-investigation`)

   Missing any one of the three is an incomplete change.

2. **Implement preconditions and rate limits in `policies/`.** Per-action
   attempt caps and cooldown windows are data, not scattered `if` statements.

3. **Implement execution in `recovery/`**, parameterised and idempotent. No
   arbitrary input reaching a shell, an SDK, or an eval. Simulated actions only
   — the MVP never touches real cloud resources.

4. **Implement verification.** This is the step that gets skipped and it is the
   step that matters. Decide concretely how success is confirmed *from resulting
   state*, not from the action returning 200.

5. **Wire approval as permission to re-validate, not permission to execute.**
   Inside the execution transaction, re-read lab state, job state and attempt
   counters. If anything changed since approval, block and tell the operator.

6. **Resolve the incident only when verification passes.** A submitted job, a
   200 from the action call, or a happy log line is **not** verification.

## Policy evaluation order — fixed

Evaluate in this order and record which step blocked the action:

1. **Structural** — action type in allow-list, parameters match schema
2. **Target validity** — every target exists and belongs to the incident
3. **State** — lab / dependency / job currently eligible
4. **Concurrency** — no running job for the same target; row locked
5. **Rate limits** — attempt caps, cooldown windows
6. **Authorisation** — approval present, authorised actor, not expired
7. **Idempotency** — key unused; if used, return the prior result

Reordering these is a behaviour change. Do not do it casually.

## Idempotency

`UNIQUE(RecoveryAction.idempotencyKey)` in the database, not an application
check. Derive the BullMQ `jobId` from the same key so duplicate enqueues collapse
into one job. See the `background-job` skill.

## Mandatory negative tests

The negative suite is not optional for this module:

- Action not in the allow-list → blocked, reason recorded
- Target outside the incident → blocked at step 2
- Precondition failing (lab already recovered) → blocked at step 3
- Rate limit exceeded → blocked at step 5
- **Duplicate approval → executes exactly once**
- **Stale approval → revalidated and blocked**, not honoured
- **Verification fails → incident stays open / `manual_review`, never `resolved`**
- Policy denial writes an audit entry naming the blocking step

## Verify

```bash
npm run build -w @labops/api
```

Execute the action against a seeded scenario and read the full audit trail. Every
step above must be visible in it. Then run the failure path and confirm the
incident is still open.
