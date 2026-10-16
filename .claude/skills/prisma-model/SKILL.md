---
name: prisma-model
description: Use when adding or changing a Prisma model, enum or constraint in apps/api/prisma/schema.prisma. Covers pushing invariants down into the database instead of application logic, enum-typed state machines, append-only tables, and updating the ER diagram.
---

# Adding or changing a database model

## Preconditions

Read `CLAUDE.md §6`. The question to answer before writing any line: *which
invariant must this model make true?* If the answer is "none", the model is
probably fine as a plain table. If the answer is "the app checks it", push it
down here.

## Procedure

1. **Name it in domain terms.** `Incident`, `RecoveryAction`, `AuditEntry`,
   `OperationalEvent`. Not `Record`, `Item`, `Entity`, `Data`.

2. **Type every status as an enum, not a string.** `status String` allows a
   typo that reaches production. Enums make illegal states unrepresentable.

3. **Encode every concurrency invariant as a constraint.** From `CLAUDE.md §6`:

   | Invariant | Mechanism |
   |---|---|
   | One effect per logical event | `deduplicationKey String @unique` |
   | One execution per approved action | `idempotencyKey String @unique` |
   | One open incident per window | unique index scoped to open incidents |
   | Audit is append-only | no update path in app code; triggers reject `UPDATE`, `DELETE` and `TRUNCATE` |

   Prefer a unique index over a "check-then-insert" in application code. Under
   retries and concurrency, application checks lose.

4. **Model relationships explicitly.** `IncidentLab` is a join table that also
   carries `reason` and `signalScore` — that is deliberate. Correlation must be
   explainable, so the reason lives with the row, not in a log line.

5. **Store nothing you cannot explain.** No secrets in plaintext. Any
   credential column holds an AES-256-GCM sealed value
   (`platform/secrets/crypto.ts`) and is never selected into an API response. See `CLAUDE.md §5`.

6. **Redacted, not raw.** Event `metadata` holds redacted structured data. Do
   not add a column that stores the full unredacted provider payload.

## Apply and verify

```bash
npm run prisma:migrate:dev -w @labops/api -- --name <change> --create-only
# Read the generated SQL before applying. Prisma turns a type change into
# DROP COLUMN + ADD COLUMN, which erases data; rewrite it as
# ALTER COLUMN ... TYPE ... USING. Raw SQL for partial indexes, CHECK
# constraints and triggers is added here too.
npm run prisma:migrate:dev -w @labops/api
npm run db:generate
npm run typecheck
```

## Mandatory negative test

If the model carries an invariant, prove the database rejects the violation:

- inserting a duplicate `deduplicationKey` fails
- an illegal status cannot be written (enum)
- two concurrent claims of the same action produce exactly one winner

This is an integration test against real Postgres. See `CLAUDE.md §8`.

## Update the docs

- `ARCHITECTURE.md §6` — add the model to the ER diagram
- `ARCHITECTURE.md §17` — if it changes what is implemented
- `docs/dev/` — only if it changes setup or the API surface

## Verify

```bash
npm run lint && npm run typecheck && npm run test
npm run test:integration -w @labops/api   # real Postgres + Redis
```

Confirm no other module started reaching into this model directly. Modules own
their tables and expose behaviour, not tables (`CLAUDE.md §4`).
