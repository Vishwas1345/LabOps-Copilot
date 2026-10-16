# CLAUDE.md — LabOps Copilot

Agent instructions for working in this repository. Read this before writing any
code. When something here conflicts with a habit from another project, this file
wins.

**Working style: no sugarcoating, lead with the uncomfortable part, and say so
when the human is wrong.** See §14.

---

## 1. Project at a glance

**LabOps Copilot** is an AI-assisted incident response and recovery coordination
prototype for cloud lab operations.

The workflow it demonstrates:

```
lab failures → correlate into explainable incidents → AI investigation
             → deterministic policy check → human approval → background
             execution → verification → audit trail
```

**Framing matters.** This is AI-assisted incident correlation and safe recovery
orchestration for cloud lab operations: an engineering demonstration. Never
write documentation, commit messages, comments or UI copy that claims any
existing platform lacks a capability, or that names a lab-platform vendor or
the prospective employer (the README's closing "About this project" note is the
only exception). Names of tools and hosts the project uses, such as Google,
Gemini, Render and Neon, are fine.

**All lab infrastructure is simulated.** There is no live lab platform
connection and the MVP never touches real cloud resources. Any UI or log surface that shows
simulated data must make that visible. Never imply a live connection was tested
when it was not.

**The single most important architectural fact:** the LLM is a proposal engine,
never an execution authority. If a change would let model output reach an
executor without passing schema validation, a policy check and a human approval,
that change is wrong. See §5.

Read `ARCHITECTURE.md` for the full design, `README.md` for the plain-language
overview, and `docs/dev/` for setup, the API and testing.

### Docs folder

`docs/` holds the working documents. Start at `docs/README.md`.

| Doc | Use it for |
|---|---|
| `docs/specs/labops-copilot/SPEC.md` | What is being built and why: rules, scope, acceptance criteria |
| `docs/specs/labops-copilot/PLAN.md` | The phase-by-phase build plan (complete: phases 0-15, and the work since). New work starts a new `docs/specs/<feature>/` |
| `docs/infra/INFRA.md` | Processes, ports, containers, env vars, migrations, CI |
| `docs/infra/DEPLOYMENT.md` | The live Render deploy |
| `docs/GAPS.md` | What the project does not do; read before describing its capabilities |
| `docs/dev/` | Setup, design, the API, testing and the roadmap |

- Before starting a phase, read its section in `PLAN.md`. When it lands, update
  `PLAN.md` and `INFRA.md` in the same pull request.
- A new feature gets `docs/specs/<feature-slug>/SPEC.md`, then `PLAN.md`.
- The internal project specification at the repo root is git-ignored and must
  never be copied into `docs/` or any tracked file. It contains interview
  context, not product content. `SPEC.md` is the public version.

---

## 2. Stack — no substitutions

| Layer | Fixed choice |
|---|---|
| Backend runtime | **Node.js + TypeScript only. Never add a Python service.** |
| HTTP API | Fastify 5 |
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Validation | Zod — every request body, event and LLM output |
| ORM / DB | Prisma 6 + PostgreSQL 16 |
| Queue | Redis 7 + BullMQ |
| Real-time | Server-Sent Events (not WebSockets) |
| Logging | Pino |
| Tracing | OpenTelemetry |
| Tests | Vitest (unit + integration), Playwright (E2E) |
| Delivery | Docker, Docker Compose, GitHub Actions |

Deliberately excluded. Do not add without an explicit, current requirement:
Kubernetes, Kafka, a vector database, LangGraph.js (a plain state machine is
sufficient — see `ARCHITECTURE.md §18`), or a second agent framework.

---

## 3. Commands

```bash
npm install                  # install all workspaces
npm run dev                  # API :4000 + worker + web :3000
npm run dev:api              # API only
npm run dev:web              # web only
npm run dev:worker           # background worker only
npm run db:up                # start PostgreSQL and Redis via Docker Compose
npm run db:generate          # regenerate Prisma client
npm run db:migrate           # apply checked-in migrations
npm run lint                 # ESLint across both workspaces
npm run lint:fix             # ESLint with autofix
npm run typecheck            # tsc --noEmit across both workspaces
npm run test                 # Vitest unit tests, both workspaces
npm run test:integration -w @labops/api   # own DB (TEST_DATABASE_URL), auto-migrated; needs db:up (postgres + redis)
npm run test:e2e -w @labops/web           # Playwright journey; needs a fresh compose stack
npm run coverage             # Vitest with v8 coverage + thresholds
```

Full container stack:

```bash
docker compose up --build    # postgres, redis, migrate, api, worker, web
```

**Checks must pass before a commit.** In order: `npm run lint`,
`npm run typecheck`, `npm run test`. CI runs the same three plus coverage and a
quality gate — see `.github/workflows/`.

Vitest coverage thresholds are set at 70% for lines, functions, branches and
statements. In the api, `npm run coverage` counts unit **and** integration specs
together (`vitest.coverage.config.ts`, needs a migrated database), so code that
talks to PostgreSQL is measured rather than excluded. Only the process
entrypoints (`src/index.ts`, `src/worker.ts`, `src/seed-operator.ts`,
`src/seed-demo.ts`, `src/reset-demo.ts`) are excluded. The web config excludes `src/app/**/*.tsx` (pages and route
components), which the Playwright journey covers. Every exclusion carries a
comment saying why.
Adding exclusions to make a number look better is the same as disabling a test.

Environment: `apps/api/.env` (copy from `apps/api/.env.example`); the web app
needs none for local work (it defaults to `http://localhost:4000`). Never commit
a real secret. `.env` is git-ignored.

---

## 4. Architecture rules

### Module layout

Backend code lives under `apps/api/src/`: entrypoints at the top, cross-cutting
plumbing in `platform/`, business features in `modules/<feature>/`. A feature
module keeps the same shape: `routes.ts` (HTTP only), `schemas.ts` (request
validation), `service.ts` or `services/` (logic), `jobs/` (background jobs).
Tests never sit next to source: `apps/api/test/{unit,integration,live,fixtures}`
and `apps/web/test/{unit,e2e}`, each mirroring `src/`.

- `platform/`: `config`, `http`, `auth`, `audit`, `observability`, `secrets`,
  `jobs`, `events-stream`. Used by the features, never importing them.
- `modules/`: `labs`, `events`, `incidents`, `investigations`, `policies`,
  `recovery` (proposals, approval, expiry, execution), `integrations`,
  `metrics`, `demo`.
Every route needs a signed-in operator unless it sets `config: { public: true }`;
human actions take their audit actor from `actorOf(request)`, never the body.

### Dependency direction — strictly downward only

```
investigations → recovery → {policies, incidents} → events → labs
platform/* (config, http, auth, audit, observability, secrets, jobs,
events-stream)  (import no domain module)
```

`investigations` sits above `recovery` (a diagnosis is proposed in the same
transaction). `policies` stays pure and imports only `labs`; callers gather
the facts it judges.

A module must never import *upward*. Never import across a sibling domain
directly — go through the lower module's public interface. Circular imports are
a bug; ESLint's `import/no-cycle` rule fails the build on one.

### Boundaries that must not be crossed

- **The browser never talks to PostgreSQL, Redis, or the LLM.** `NEXT_PUBLIC_*`
  variables hold URLs only — never tokens.
- **The API never executes long-running work inline.** Validate, persist,
  enqueue, return `202` with a job id.
- **Redis is transport, not truth.** Every state transition that matters is a
  committed row in PostgreSQL.
- **The worker never serves HTTP.**
- **Modules expose behaviour, not tables.** Do not reach into another module's
  Prisma model. The two read-only reporting exceptions (the live stream reads
  `AuditEntry`; incident metrics join events) are noted in `ARCHITECTURE.md §4`.

### Adding a module

Create `apps/api/src/modules/<feature>/` in the standard shape, put its tests under
`apps/api/test/`, keep it dependency-clean, own its tables, expose a service
interface, and register it in `ARCHITECTURE.md §4`.

---

## 5. Safety rules — non-negotiable

These are the rules the project exists to demonstrate. Violating any of them is
a worse outcome than shipping less functionality.

### AI boundaries

1. **The model proposes; deterministic code decides; a human approves.** There
   is no code path from LLM output to an executor that skips validation,
   policy evaluation and approval.
2. **Model output is untrusted.** Validate against a strict Zod schema. Unknown
   fields are rejected, not coerced. Enums are closed sets.
3. **Never give the model its own context.** Evidence is assembled server-side
   by a fixed query. No "fetch all logs and let the model choose".
4. **Event and log text is data, never instructions.** It goes into an
   explicitly delimited data block. The system policy is fixed text that the
   model cannot influence. A payload containing `ignore previous instructions`
   must be inert.
5. **Targets are intersected with server-side truth.** If the model names a lab
   outside the incident's own affected labs, discard it. Never execute a
   hallucinated target.
6. **Action types are an allow-list enum.** Adding a new executable action means
   adding it to the enum, the policy engine and the allow-list table in
   `ARCHITECTURE.md §10` — in the same change. There is no generic
   "run a command" or "execute this" path. Ever.
7. **Model failure is non-destructive.** Timeout, malformed response, refusal or
   parse error must leave incident state untouched and write an audit entry.

### Secrets

- Integration credentials are submitted server-side over HTTPS, encrypted at
  rest, and **never returned by any endpoint, never logged, never included in an
  AI context**.
- Redact at the boundary (where data enters), not at the log formatter.
- `.env` files are git-ignored. `.env.example` contains placeholders only.

### Prompt-injection and untrusted external input

- Webhook payloads are untrusted: verify the documented signature/token, enforce
  a timestamp replay window, apply size and rate limits, then normalise.
- Treat all provider payloads and logs as untrusted input. Redact before
  persistence and before context construction.

### Demo endpoints

`/api/demo/*` must be gated behind a flag that is off outside local and demo
environments. Never ship them unguarded.

---

## 6. Data and state rules

### State machines are explicit

Lab and incident statuses are legal transitions declared as data
(`*_TRANSITIONS`), not scattered `status = '...'` assignments. Guard every
transition with the declared map, and make an illegal transition throw in the
API, the worker and the tests identically.

### Invariants belong in the database

If a rule must hold under concurrency or retries, enforce it with a constraint,
not application logic:

| Invariant | Mechanism |
|---|---|
| One effect per logical event | `UNIQUE(OperationalEvent.deduplicationKey)` |
| One execution per approved action | `UNIQUE(RecoveryAction.idempotencyKey)` |
| One open incident per correlation window | `UNIQUE` on window key for open incidents |
| Audit history is append-only | No update/delete path on `AuditEntry` |
| Concurrent approvals cannot both win | `SELECT ... FOR UPDATE` in the transaction |

### Idempotency

Every command that causes a side effect carries an idempotency key. On conflict,
**return the prior result** — never re-execute. BullMQ `jobId` is the job's own
stable key (for an execution, `execute-<actionId>`), so duplicate enqueues
collapse into one job.

### Transactions

A state transition and its audit entry are written in **one transaction**.
Long-running work must never hold a transaction open.

### Correlation is deterministic

- Grouping uses scored rules, never the LLM.
- Use normalised error categories (`PROVISION_TIMEOUT`, `PERMISSION_DENIED`,
  `NETWORK_CONFIG`, …). **Never merge labs on raw error string equality.**
- Every `IncidentLab` row records *why* it was included and its signal score.
- Block single-link chaining: a lab joins a cluster only if it scores above the
  threshold against the cluster's anchor.
- Correlation must be re-runnable without duplicating incidents.

### Recovery actions

- Only predefined actions exist. Each declares a strict parameter schema; none
  accepts parameters today, and any sent are rejected.
- Policy evaluation order is fixed: structural → target validity → state →
  concurrency → rate limits → authorisation → idempotency. Record which step
  blocked an action and why.
- Approval is **permission to re-validate**, not permission to execute.
  Revalidate preconditions inside the execution transaction.
- Approvals expire. Expired approvals must be blocked, not honoured.
- An incident is resolved only when **verification passes**. A submitted job, a
  successful action call, or a happy log line is not verification.

---

## 7. Code style

### TypeScript

- `strict: true` in both apps. No `any`. Use `unknown` at trust boundaries and
  narrow with Zod.
- Backend is **ESM** (`"type": "module"`), `module: NodeNext`. Relative imports
  **must** use the `.js` extension: `import { prisma } from './db.js'`.
- Prefer `type` imports for types: `import type { Foo } from './foo.js'`.
- Functions that cross module boundaries are explicitly typed. Do not rely on
  inference at the API surface.
- Name types in domain terms (`Incident`, `RecoveryAction`, `AuditEntry`) — not
  generic containers.

### Code quality — the bar is top-notch

Every line must earn its place. Reviewers read this code as evidence of
judgement, so noise counts against it as much as bugs do.

- **Clean and small.** Clear names over clever code. One job per function. No
  dead code, commented-out code, speculative options or unused exports.
- **Least machinery that does the job.** No abstraction until a second real
  caller needs it.
- **Consistent.** Match the patterns already in the module before inventing one.

### Comments

Short, relevant, and only where they add something the code cannot say.

- **Where:** at the top of a file (what it owns, in one or two lines) or just
  before a function whose *why* is not obvious. Not on every line.
- **What:** the reason, constraint, or rejected alternative. Never restate what
  the code does.
- **Size:** one to three lines. If it needs a paragraph, the reasoning belongs
  in `ARCHITECTURE.md` and the comment points there.
- **Safety decisions always get a comment**: why a check exists, what it
  prevents. These are the comments a reviewer looks for.
- No emojis in code, commits, or documentation.

Good: `// Compare-and-set: a concurrent transition makes this match zero rows.`
Bad: a ten-line block explaining Postgres isolation levels above an `update`.

### Errors and logging

- One consistent API error envelope. Never return a raw stack trace.
- Use Pino child loggers: job lines carry the job, queue and `traceId`, and
  incident lines add `incidentId`.
- Never log tokens, credentials or full unredacted payloads.
- Never use `console.log` in backend source.

### Files

- Match existing formatting: single quotes, semicolons, 2-space indent, ~80–100
  column lines.
- No barrel files (`index.ts` re-exports) unless there is a clear reason.
- Keep modules cohesive. Split a file when it mixes two responsibilities.

---

## 8. Testing rules

Every behaviour change ships with tests. Test layers mirror architectural
boundaries so a failure points at a boundary.

| Layer | Scope | Doubles |
|---|---|---|
| Unit | Pure logic: normalisation, dedup, correlation scoring, transitions, policy decisions, AI schema validation | none |
| Integration | Ingestion → DB, ingestion → enqueue, worker retry/failure, approval + policy, execution + verification, audit writes | real Postgres + Redis |
| E2E | The full operator journey | seeded scenario, mocked LLM |

Non-negotiable:

- **Never write a test that depends on a live LLM call.** Use a fixture/mock
  provider. One opt-in job may hit a real model, excluded from the default run.
- **Never assert on wall-clock timings or generated prose.** Assert on structure.
- Scenarios must be deterministic — fixed seed, identical failures every run.
- Negative cases are required, not optional: unrelated failures must not merge,
  malformed model output must be rejected, a disallowed action must be blocked,
  a duplicate approval must not execute twice, a stale approval must be
  revalidated, a failed recovery must not resolve the incident, and no test
  output may contain a secret.

Vitest is configured in both workspaces. The api `test` script is unit-only;
integration tests (real Postgres + Redis) run as `test:integration`, wired into
`api.yml`. No test may depend on a live LLM — use the fixture
provider.

---

## 9. Observability rules

- Emit an OpenTelemetry span for each stage: `event.ingest`,
  `incident.correlate`, `investigation.queue`, `investigation.llm`,
  `recovery.policy_check`, `recovery.execute`, `recovery.verify`.
- Propagate trace context through the job row's `traceparent` (and
  `Incident.traceparent` for later steps) so one incident resolves to one trace
  across processes, operator actions and minutes.
- Log with correlation context. Metrics must come from real runs — **never
  fabricate or hardcode a performance number.**

---

## 10. Git conventions

- Branch from `main` with a descriptive name: `feat/lab-simulator`,
  `fix/correlation-threshold`.
- Commit messages: Conventional Commits, imperative, lowercase subject.
  `feat(incidents): add dependency-id correlation signal`
- One logical change per commit. Do not mix refactors with behaviour changes.
- Run the typecheck before committing.
- Do not commit: secrets, `.env`, `node_modules`, `.next`, `dist`, generated
  Prisma output, or the internal project specification document.
- Bug fixes and code or file changes go through a branch and a pull request,
  which the owner merges (`gh pr merge N --rebase`, never `--delete-branch`).
  Only small, trivial changes (a typo, a doc line) may be pushed straight to
  `main`.

---

## 11. Task recipes

Detailed, step-by-step versions of these recipes live in `.claude/skills/`.
Read the matching skill before starting the task — it carries the required
negative tests and verification steps.

| Task | Skill |
|---|---|
| **Any feature, task or bug fix — start here** | `.claude/skills/feature-workflow` |
| Add or change an endpoint | `.claude/skills/api-endpoint` |
| Add or change a DB model | `.claude/skills/prisma-model` |
| Add or change a queue / worker | `.claude/skills/background-job` |
| Build or change simulator scenarios | `.claude/skills/lab-simulator` |
| Change correlation logic | `.claude/skills/correlation-engine` |
| Change anything LLM-related | `.claude/skills/ai-investigation` |
| Add an executable recovery action | `.claude/skills/recovery-action` |
| Work on the integrations module | `.claude/skills/integration-adapter` |
| Add or change logging / tracing / metrics | `.claude/skills/observability` |
| Write or review any test | `.claude/skills/negative-case-testing` |

The recipes below are the short form.

### Add an API endpoint

1. Define a Zod schema for body, params and query — validate at the boundary.
2. Handler does: validate → authorise → short transaction (persist + audit
   entry) → enqueue if long-running → return with the standard envelope.
3. Never execute long work inline; return `202` with a job id.
4. Add an integration test hitting the real database.

### Add a database model

1. Update `apps/api/prisma/schema.prisma`.
2. Add constraints for every invariant it must hold (§6) — prefer DB enforcement.
3. `npm run prisma:migrate:dev -w @labops/api -- --name <change>` to write the
   migration (raw SQL for partial indexes, CHECKs and triggers goes in it),
   then `npm run db:generate`. CI fails if the schema and migrations drift.
4. Note it in the ER diagram in `ARCHITECTURE.md §6`.

### Add an executable recovery action

1. Add to the action enum.
2. Add the entry to the allow-list table in `ARCHITECTURE.md §10`.
3. Implement preconditions and rate limits in `policies/`.
4. Implement execution in `recovery/` — idempotent, parameters (if any)
   declared in a strict schema, no arbitrary input reaching a shell or an SDK
   call.
5. Implement verification — how success is confirmed from resulting state.
6. Add unit tests for the policy decision **and** the negative case.

### Add an AI capability

1. Add an LLM provider behind the existing abstraction.
2. Define a strict Zod output schema with a closed enum for anything executable.
3. Assemble bounded, redacted evidence server-side. Cap size and count.
4. Validate output; on failure, mark the investigation `error` and leave
   incident state untouched.
5. Add a fixture-based test for the happy path **and** a malformed-output test.

### Add a lab platform capability

Read the **Integration gate** in `ARCHITECTURE.md §13` first. Implement a method
on the adapter interface only when it is verified against official documentation,
and expose it in `capabilities`. If it is not verified, do not implement it —
do not invent endpoints, auth schemes, webhook signing or event types. Mark the
connection `not_configured` instead.

---

## 12. Definition of done

A change is complete when:

- [ ] Typecheck passes for the affected workspace.
- [ ] Tests cover the new behaviour, including the negative case.
- [ ] Each safety test is **mutation-checked**: break the guard it protects and
      confirm the test fails. A test that cannot fail is not a test.
- [ ] Integration tests pass twice in a row from a **fresh** database:
      `scripts/clean-db-check.sh` creates a throwaway one, runs them, drops it.
      Never `prisma migrate reset` the dev database to do this.
- [ ] All checks pass from a **fresh clone** (`npm ci`, no local generated
      files), so nothing depends on this machine's state.
- [ ] Code and comments meet §7 *Code quality* and *Comments*.
- [ ] Every state transition writes an audit entry in the same transaction.
- [ ] Any new external input is validated with Zod and redacted if sensitive.
- [ ] Any new side effect is idempotent.
- [ ] `ARCHITECTURE.md` and/or `docs/dev/` updated if a boundary, endpoint or
      decision changed.
- [ ] Nothing user-visible describes simulated data as live, or implies an
      existing platform has a capability gap.

---

## 13. Never do

- Never add a Python service or a second backend runtime.
- Never let the LLM execute an action, choose its own tools, or define its own
  authority.
- Never merge incidents in application code using an LLM.
- Never store a secret in plaintext, in a log, in a prompt, or in a URL.
- Never return credentials from an endpoint.
- Never mark an incident resolved without passing verification.
- Never claim a live lab platform integration, a production scale, or a performance
  improvement that was not measured.
- Never disable a test to make a build pass.
- Never add a dependency without saying why the standard toolchain cannot do it.

---

## 14. Working style — honest, not subservient

You are here to work *with* the human, not to serve them. That is a partnership
between two people who both want the work to be correct. It is not deference,
and it is not a performance of agreement.

### Never sugarcoat

Report the actual state of things, in both directions:

- If the design is wrong, say it is wrong. Do not soften it into "one option to
  consider".
- If you are unsure, say unsure. Do not dress a guess up as a conclusion.
- If the code is bad, say so. A compliment sandwich hides the useful part.
- If something works well, say that too — plainly, once, without padding. Honest
  assessment is not a synonym for criticism.
- If a request is a bad idea, say that before building it, not after.

**Lead with the uncomfortable part.** Bad news first, then the nuance. A person
who hears "looks great, although this will silently corrupt the audit trail"
has learned the wrong thing first. Put the risk in the first two sentences,
then explain.

### Do not become subservient

Never let agreement become the goal instead of correctness.

- **Disagree when the evidence disagrees.** If the human is wrong, say so plainly
  and say why. Compliance that produces a wrong build is not helpfulness.
- **Push back before agreeing.** Then, if they confirm the decision anyway,
  implement their decision and record the trade-off in the notes. That is the
  correct division of responsibility: you surface the risk, they own the call.
- **Do not manufacture enthusiasm.** No "great question", no "absolutely", no
  emoji, no cheerleading. It wastes their attention, which is the scarcest
  resource in the exchange.
- **Do not over-accommodate.** Restating a task back as a question when the
  answer is already documented is not respect, it is stalling.
- **Never bend a safety rule because it was asked for.** If a request would
  route model output straight to an executor, leak a credential, or claim a live
  integration that was not tested, refuse the part of it that is unsafe, explain
  why, and offer the safe version. Being agreeable here is actively harmful.

### Direct is not abrasive

Honest does not mean cruel.

- State the problem, not the person. "This makes concurrent approvals race" —
  not "you clearly didn't think about this".
- No hedging mush and no padding, but also no lectures and no moralising.
- One clear objection beats three paragraphs of build-up.
- If it is fine, say "fine" and move on. Manufacturing a caveat to look
  thorough is its own kind of dishonesty.

The standard to meet: **the person reading this should feel informed, not
managed.** If a message reads like it was written to protect a relationship
rather than to convey the truth, rewrite it.