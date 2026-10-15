# LabOps Copilot

**From scattered lab failures to an evidence-backed, safely managed incident
workflow.**

LabOps Copilot is an AI-assisted incident response and recovery coordination
prototype for cloud lab operations. It ingests operational events from a
simulated lab fleet, correlates unrelated-looking failures into explainable
candidate incidents, runs an LLM investigation over bounded evidence, and then
routes any proposed recovery through a deterministic policy engine and a human
approval before a background worker executes and verifies it.

> **Positioning.** This is a proposed companion concept for a CloudLabs-style
> platform — a focused workflow and engineering demonstration. It is **not** a
> claim that Spektra Systems lacks incident management, correlation or recovery
> capability. Public materials describe overlapping CloudLabs and Cosmos
> features; whether a genuine product gap exists needs validation with the
> Spektra team.
>
> **All lab infrastructure in this repository is simulated.** The MVP does not
> touch real cloud resources and makes no live CloudLabs connection.

![The overview dashboard after the demo scenario](docs/images/dashboard.png)

**Quick start** (Docker only):

```bash
echo "SEED_OPERATOR_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up --build
```

Open `http://localhost:3000`, sign in as `operator` with that password, and
click **Run demo scenario**. Then follow [the walkthrough](#walkthrough-one-incident-end-to-end).

---

## Contents

- [Why this exists](#why-this-exists)
- [Walkthrough: one incident, end to end](#walkthrough-one-incident-end-to-end)
- [How it works](#how-it-works)
- [The safety model](#the-safety-model)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [API overview](#api-overview)
- [Testing](#testing)
- [Observability](#observability)
- [Roadmap](#roadmap)
- [Before production](#before-production)
- [Non-goals](#non-goals)

---

## Why this exists

A single failed lab is a symptom. A burst of thirty failed labs may share one
root cause — or may be three unrelated problems that happen to look alike. An
operator needs to tell those cases apart, gather evidence, choose a safe action,
and confirm whether the fix actually worked.

Dashboards show *which* labs failed. This project demonstrates the workflow
around them:

1. **Correlate** failures into candidate incidents with recorded reasoning.
2. **Investigate** each incident with an LLM over bounded, redacted evidence.
3. **Propose** a recovery action from a fixed allow-list.
4. **Validate** it against deterministic safety rules — never against the model.
5. **Approve** it as a human operator.
6. **Execute** it asynchronously with idempotency and bounded retries.
7. **Verify** the resulting state, then close or escalate the incident.
8. **Record** every transition in an append-only audit trail.

The negative cases matter as much as the happy path: unrelated failures must
*not* merge, unsafe actions must be blocked, stale approvals must be
revalidated, a failed recovery must never resolve an incident, and a malformed
model response must be rejected without corrupting state.

---

## Walkthrough: one incident, end to end

The seeded **training-event** scenario: 40 simulated labs, a burst of 12
provisioning timeouts on one shared image registry, scattered permission and
network failures, and one redelivered event. The same seed gives the same
labs, failures and incidents every run.

1. **Run demo scenario** on the overview. The tiles, the failure timeline and
   the labs donut fill in live; the burst is one tall bar on the timeline.
   Light and [dark](docs/images/dashboard-dark.png) themes follow the system.
2. **Incidents.** Deterministic correlation forms one 12-lab
   `PROVISION_TIMEOUT on image-registry` incident and keeps the 7 unrelated
   failures as separate single-lab incidents. The redelivered event is stored
   once.
3. **Open the 12-lab incident.** Each lab shows why it was included and its
   correlation strength; the timeline on the right is the incident's audit
   history.

   ![The resolved burst incident](docs/images/incident.png)

4. **Investigate.** The AI analyst (a deterministic fixture by default; Gemini
   is opt-in) returns a likely cause, the evidence for it, what is missing and
   its confidence, and recommends `RETRY_PROVISIONING` on the 12 labs.
5. **Policy, then a human.** The seven policy steps pass, so the action waits
   for approval with its targets and expiry. **Approve** it: the worker
   re-checks policy, retries, then verifies by re-reading every lab. The
   incident resolves only because verification passed, and the page updates
   without a reload.
6. **The refusal.** Open a `PERMISSION_DENIED` incident and **Investigate**. The
   fixture plays an overconfident model and recommends a retry; policy blocks
   it at the state step and says why. Nothing is offered for approval.

   ![A retry blocked by policy](docs/images/policy-blocked.png)

7. **The audit trail** records every step, with who or what did it and when.

### Follow it through a trace and the logs

Start the stack with the opt-in trace viewer instead:

```bash
docker compose -f docker-compose.yml -f compose.tracing.yml up --build
```

Run the walkthrough, then open Jaeger at `http://localhost:16686` and search
for service `labops-worker`. The resolved incident is **one trace**: all seven
lifecycle spans, across the api and the worker, including the investigation
and approval that operators triggered minutes later from new requests.

![One incident as one trace in Jaeger](docs/images/trace.png)

The worker's job logs carry that trace id, and its incident lines (created,
investigation finished, execution finished) carry the incident id too, so one
search follows it through the logs:

```bash
docker compose logs worker | grep <traceId>
```

### Numbers from a real run

From one run of the scenario on an Apple M4 laptop (Docker, fixture model),
read from `GET /api/metrics`. Nothing here is estimated.

| Figure | p50 | Note |
|---|---|---|
| First event to incident | 2.14 s | About 2 s is the deliberate dispatch delay that lets a burst collapse into one correlation run |
| Correlation run | 9 ms | 8 runs, one per window |
| Investigation job | 30 ms | Fixture model; a real model adds its own latency |
| Recovery execution | 56 ms | Revalidate, retry, verify |
| Approval to verified | 2.09 s | The same 2 s dispatch delay, then the run |

---

## How it works

```
Lab simulator ──▶ Event ingestion ──▶ Deterministic correlation
                                          │
                                          ▼
                                  AI investigation
                                  (structured output,
                                   Zod validated)
                                          │
                                          ▼
                                   Policy engine  ──▶ blocked: audit the reason
                                          │
                                          ▼
                                  Human approval   ──▶ rejected
                                          │
                                          ▼
                                  BullMQ recovery job
                                          │
                                          ▼
                                  Simulated action + verification
                                          │
                                          ▼
                                  Audit trail + SSE live updates
```

A guided sequence diagram of the full lifecycle, including the deny, stale and
verification-failure branches, is in
[ARCHITECTURE.md §5](ARCHITECTURE.md#5-core-data-flow--the-incident-lifecycle).

---

## The safety model

The single most important design decision in this project: **the LLM is a
proposal engine, never an execution authority.**

| Concern | How it is handled |
|---|---|
| Log text containing injected instructions | Event text is passed as delimited *data*; the system policy is fixed and not model-controlled |
| Model inventing an action or a target | Output must match a strict Zod schema; actions are a closed enum; targets are intersected with server-side truth before execution |
| Unsafe or unvalidated action | A deterministic policy engine decides. The model has no path to the executor |
| Accidental execution | Only predefined, parameterised actions exist. There is no generic "run a command" path in the codebase |
| Duplicate clicks, redelivered events, worker retries | Idempotency keys and dedup keys backed by unique DB constraints; duplicates return the prior result |
| State changing between approval and execution | Preconditions are revalidated inside the execution transaction; approvals expire |
| Model failure | Non-destructive. The incident stays `open` with an audit entry |
| Secrets | Encrypted at rest, never returned by an API, redacted from logs and from AI context |
| Durable state | PostgreSQL is the source of truth. Redis is queue transport, never the record |

Correlation follows the same rule: **grouping is deterministic and
explainable**, not model-generated. Every lab in an incident stores why it was
included and with what signal score, and the UI renders that rationale. Raw
error strings alone never merge two failures, and single-link chaining is
blocked so unrelated failures cannot drift into one meaningless cluster.

### What structured output is actually worth

The live model runs behind a JSON-schema constraint that Gemini accepts. That
constraint is **not** the safety boundary, and we measured why rather than
assuming it.

On a live run the model returned:

```json
"evidenceAgainst": ["ev-4 lab-9: unrelated category (PERMISSION_DENIED) and no dependency specified"]
"recommendedAction": "Investigate the image-registry service stability and verify network connectivity..."
```

A full sentence where an event id belongs, and a full sentence where one of four
enum values belongs — with the schema accepted throughout. The provider enforced
**shape**. It did not enforce **values**, and it could not enforce length or
range limits at all.

Had this pipeline trusted the provider's schema as its boundary, a model would
have handed it a free-text recovery action. Zod rejected both. That is the
whole argument for keeping the boundary in our code, in one measured example
rather than a principle.

| Constraint | Provider enforces | Zod enforces |
|---|---|---|
| Field present, correct type | yes | yes |
| No unknown fields | no | yes |
| Action is one of four names | no | yes |
| Evidence ids within length | no | yes |
| Confidence within 0–1 | no | yes |
| Array bounds | yes | yes |

---

## Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 15, React 19, TypeScript | Operator dashboard and workflows |
| Styling / UI | Tailwind CSS, shadcn/ui | Consistent interface components |
| Charts | Recharts | Failure timeline and labs-by-state donut |
| Backend | Node.js + TypeScript | All backend processing |
| HTTP API | Fastify 5 | REST endpoints and SSE |
| Validation | Zod | Request, event and LLM output schemas |
| ORM | Prisma 6 | Type-safe database access and migrations |
| Database | PostgreSQL 16 | Labs, events, incidents, evidence, approvals, audit |
| Queue | Redis 7 + BullMQ | Asynchronous investigation and recovery |
| AI | LLM API with structured outputs | Evidence-based diagnosis and action recommendation |
| Real-time | Server-Sent Events | Live dashboard updates |
| Logging | Pino | Structured logs |
| Tracing / metrics | OpenTelemetry | End-to-end observability |
| Tests | Vitest, Playwright | Unit, integration and E2E |
| Delivery | Docker, Docker Compose, GitHub Actions | Reproducible environment and CI |

Node.js is the only backend runtime — no Python services. The architecture is a
modular monolith with a separate worker process rather than microservices;
`ARCHITECTURE.md §18` documents each trade-off and what would change it.

---

## Architecture

Full documentation: **[ARCHITECTURE.md](ARCHITECTURE.md)**

It covers design principles, system context and trust boundaries, runtime
topology, the backend module map, the incident lifecycle sequence, the data
model with DB-level invariants, lab and incident state machines, the correlation
engine and its signal weights, the AI boundary rules, the recovery safety model,
reliability and failure behaviour, observability, the CloudLabs integration
gate, the security model, the test architecture, deployment topology, current
implementation status, and the trade-offs taken.

---

## Getting started

### Prerequisites

- Node.js 22 (`.nvmrc`)
- npm 10+
- Docker (for PostgreSQL and Redis)

### 1. Install

```bash
npm install
```

### 2. Start infrastructure

```bash
npm run db:up
```

This starts PostgreSQL on `localhost:5432` and Redis on `localhost:6379` (set
`REDIS_HOST_PORT` in a root `.env` if another project holds that port).

### 3. Configure the environment

```bash
cp apps/api/.env.example apps/api/.env
```

Defaults match the compose credentials. To sign in, set `SEED_OPERATOR_PASSWORD`
(12+ characters) in that file.

### 4. Apply migrations, generate the client, create the operator

```bash
npm run db:generate
npm run db:migrate
npm run seed:operator -w @labops/api
```

Schema changes are checked-in migrations under `apps/api/prisma/migrations`.
To create one after editing `schema.prisma`, run
`npm run prisma:migrate:dev -w @labops/api -- --name <change>`.

### 5. Run the app

```bash
npm run dev
```

This starts the API on `http://localhost:4000`, the worker, and the web app on
`http://localhost:3000` via `concurrently`.

Verify:

```bash
curl http://localhost:4000/health
```

```json
{
  "service": "labops-api",
  "status": "ok",
  "checks": { "database": "up" }
}
```

The sign-in page shows the API and database status.

### Docker Compose

The compose file is the reproducible baseline for local development and CI. It
runs PostgreSQL, Redis, a one-shot `migrate` service (which also seeds the demo
operator), the API, the worker and the web app. The API starts only after
migrations have applied. Choose the operator password first, in the root `.env`
(git-ignored):

```bash
echo "SEED_OPERATOR_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up --build
```

Open `http://localhost:3000` and sign in as `operator` with that password.
With no data yet, the overview offers **Run demo scenario**; then open the
12-lab incident, **Investigate**, read the diagnosis and the policy decisions,
**Approve**, and watch it verify and resolve. Every `/api/*` route except login
and the demo trigger needs a session.

For the faster dev loop, run `npm run db:up` for infrastructure only and
`npm run dev` for the API and web app with hot reload.

---

## Environment variables

`apps/api/.env` — see `apps/api/.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required (`.env.example`: `postgresql://labops:labops@localhost:5432/labops`) | PostgreSQL connection string |
| `TEST_DATABASE_URL` | `postgresql://labops:labops@localhost:5432/labops_test` | Integration tests only; must differ from `DATABASE_URL` |
| `API_HOST` | `127.0.0.1` | API bind address |
| `API_PORT` | `4000` | API port |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed browser origin |
| `SESSION_COOKIE_SECURE` | `true` (`false` in `.env.example` and compose) | Send the session cookie over https only; off only for local http |
| `SEED_OPERATOR_USERNAME` | `operator` | Operator `seed:operator` creates or resets |
| `SEED_OPERATOR_PASSWORD` | unset (seeds nobody) | That operator's password, 12+ characters; never committed |
| `LLM_PROVIDER` | `fixture` | `fixture` is deterministic and offline; `gemini` calls the real API |
| `LLM_API_KEY` | unset | Required only when `LLM_PROVIDER=gemini`; startup fails without it |
| `LLM_MODEL` | `gemini-3.1-flash-lite` | Override this; it is the most volatile value in the project |
| `LLM_BASE_URL` | Gemini's REST endpoint | Must be https, or http on loopback: the key rides in a header |
| `LLM_MAX_ATTEMPTS` | `3` | Total attempts against 429/5xx |
| `CREDENTIALS_KEY` | unset | base64 of exactly 32 bytes, holding the AES-256 key for integration credentials. Optional: without it the settings page works and saving a credential fails by name rather than storing anything in the clear |

To run against a real model, set `LLM_PROVIDER=gemini` and `LLM_API_KEY` in
`apps/api/.env`, then:

```bash
npm run test:live -w @labops/api
```

That is the **only** command that calls a network model. It is excluded from
`npm test`, and the opt-in CI workflow triggers on `workflow_dispatch` only, so
no push or pull request can reach a provider. The key is sent as a request
header only — never in a URL, a log, a prompt, or `modelMetadata`.

`apps/web/.env`:

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Fallback API URL when `API_INTERNAL_URL` is unset. The browser never calls the API; it talks only to the web server (BFF) |
| `API_INTERNAL_URL` | falls back to `NEXT_PUBLIC_API_URL` | API base URL the web server uses; `http://api:4000` in Docker Compose |
| `SESSION_COOKIE_SECURE` | `true` | Send the web session cookie over https only; `false` for local http |

The full list, including `REDIS_URL`, `DEMO_ENABLED` and `LOG_LEVEL`, is in
`docs/infra/INFRA.md` §4. Real secrets are never committed; `.env` is
git-ignored.

---

## Project structure

```
labops-copilot/
├── apps/
│   ├── api/                     Fastify API + BullMQ worker (Node.js/TS)
│   │   ├── prisma/              Data model and migrations
│   │   ├── src/
│   │   │   ├── index.ts, worker.ts, app.ts   Entrypoints: start here
│   │   │   ├── platform/        Cross-cutting: config, http, auth, audit,
│   │   │   │                    observability, secrets, jobs, events-stream
│   │   │   └── modules/         One folder per feature: labs, events,
│   │   │                        incidents, investigations, policies, recovery,
│   │   │                        integrations, metrics, demo. Each has routes.ts,
│   │   │                        schemas.ts, service.ts (or services/), jobs/
│   │   └── test/                unit/, integration/, live/, fixtures/
│   └── web/                     Next.js operator dashboard
│       ├── src/                 app/ (pages), components/, lib/
│       └── test/                unit/ (Vitest), e2e/ (Playwright journey)
├── docs/                        Spec, plan, acceptance map, infra notes, images
├── ARCHITECTURE.md              System architecture and trade-offs
├── docker-compose.yml           The full stack
├── compose.tracing.yml          Opt-in Jaeger trace viewer
└── package.json                 npm workspaces + root scripts
```

### Root scripts

| Script | Action |
|---|---|
| `npm run dev` | Run the API, the worker and the web app together |
| `npm run dev:api` | Run the API only |
| `npm run dev:web` | Run the web app only |
| `npm run dev:worker` | Run the background worker only |
| `npm run db:up` | Start PostgreSQL and Redis via Docker Compose |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Apply checked-in migrations to the database |
| `npm run lint` | ESLint across both workspaces |
| `npm run lint:fix` | ESLint with autofix |
| `npm run typecheck` | Type check both workspaces |
| `npm run test` | Vitest unit tests, both workspaces |
| `npm run test:integration -w @labops/api` | API integration tests against their own PostgreSQL database (`TEST_DATABASE_URL`), migrated automatically |
| `npm run coverage` | Vitest with v8 coverage and 70% thresholds |
| `npm run test:e2e -w @labops/web` | Playwright journey against a running, freshly reset compose stack |

### Checks before you commit

```bash
npm run lint && npm run typecheck && npm run test
```

CI runs the equivalent (a type-checking build, lint and unit tests per workspace), plus integration tests, coverage and a quality gate.

---

## API overview

Every route needs a signed-in operator except health, sign-in and the demo
trigger. Request bodies, params and queries are Zod-validated; errors share one
envelope.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Service and database status (public) |
| `POST` | `/api/auth/login` | Sign in; sets the session cookie; rate limited (public) |
| `POST` | `/api/auth/logout` | Revoke the session |
| `GET` | `/api/auth/me` | The signed-in operator |
| `GET` | `/api/labs`, `/api/labs/summary`, `/api/labs/:id`, `/api/labs/:id/events` | Labs, counts by state, one lab, its events |
| `POST` | `/api/events` | Ingest an event: validated, redacted, deduplicated; 201 new, 200 duplicate |
| `GET` | `/api/incidents`, `/api/incidents/:id` | Incidents with filters; one incident with each lab's reason and score |
| `GET` | `/api/incidents/:id/audit` | The incident's full history, including steps that name it |
| `POST` | `/api/incidents/:id/investigate` | Queue an AI investigation; 202, or 200 with the active one |
| `GET` | `/api/incidents/:id/investigations` | Investigation results, newest first |
| `POST` | `/api/incidents/:id/recovery-proposals` | Propose an action; policy records allowed or blocked, with the step and reason |
| `GET` | `/api/incidents/:id/recovery-actions` | Proposals with their policy decisions and verification |
| `POST` | `/api/recovery-actions/:id/approve`, `.../reject` | Approve (202 with the execute job) or reject |
| `GET` | `/api/jobs/summary`, `/api/jobs/:id` | Background job state, from the Postgres mirror |
| `GET` | `/api/audit` | The audit trail, newest first, paginated |
| `GET` | `/api/events/stream` | Live updates (SSE): committed audit entries, resumable with `Last-Event-ID` |
| `GET` | `/api/metrics`, `/api/metrics/series` | Measured metrics and the failure timeline over a window (`hours`, max 168) |
| `GET` | `/api/integrations` | Integrations and the capabilities each has verified |
| `PUT` / `DELETE` | `/api/integrations/:provider` | Store a sealed credential (never echoed), or remove it |
| `POST` | `/api/integrations/:provider/test` | Run the adapter's own probe |
| `POST` | `/api/demo/scenarios/:name` | Run a seeded scenario; idempotent per seed; only when `DEMO_ENABLED` |

Sync, webhook and delivery endpoints for CloudLabs are **not built on purpose**:
their contract is unverified (`ARCHITECTURE.md` section 13).

---

## Testing

Test layers mirror architectural boundaries, so a failure points at one:

| Layer | Scope |
|---|---|
| Unit (Vitest) | Normalisation, dedup, correlation scoring, transitions, policy decisions, AI output validation, UI helpers |
| Integration (Vitest, real Postgres + Redis) | Ingestion, queue and worker retries, correlation, investigation, approval races, execution and verification, audit, metrics, one-incident-one-trace |
| End to end (Playwright) | The operator journey in a real browser against the built compose stack: grouping, the investigation, a rejection, a double-clicked approval that runs once, live verification with no reload, the policy block, the dashboard and its filter |

Each SPEC acceptance criterion is mapped to the test that proves it in
[`docs/specs/labops-copilot/ACCEPTANCE.md`](docs/specs/labops-copilot/ACCEPTANCE.md).

No test calls a live model; one opt-in workflow does (`llm-live.yml`). Every
safety test is mutation-checked: the guard is broken on purpose and the test
must fail. The negative cases are first-class: unrelated failures must not
merge, malformed model output must be rejected, disallowed actions must be
blocked, duplicate approvals must not double-execute, stale approvals must be
revalidated, a failed recovery must never resolve an incident, and no test
output may contain a secret.


## Observability

**Logs:** Pino JSON with a key-name redaction safety net; secrets are removed
where data enters. Worker lines carry the job, the trace and the incident.

**Traces:** OpenTelemetry spans for every stage, and **one incident is one
trace** across the api and the worker, even when an operator acts minutes
later:

```
event.ingest → incident.correlate → investigation.queue → investigation.llm
             → recovery.policy_check → recovery.execute → recovery.verify
```

Nothing is exported by default; `compose.tracing.yml` adds Jaeger (see the
walkthrough).

**Metrics:** derived from committed Postgres rows, so they count both
processes, survive a restart and cannot disagree with the audit trail: events,
incidents, time to first incident, correlation and job timings, queue depth,
AI outcomes, recovery outcomes, approval to verified, and the oldest open
transaction (which delays live updates). Shown on the overview; served by
`/api/metrics`. Every number comes from a real run.


## Continuous integration

Workflows under `.github/workflows/`:

| Workflow | Role |
|---|---|
| `changes.yml` | Runs on pushes and pull requests to `main`. Detects whether a change touched `apps/web` or `apps/api` (root manifests count for both), dispatches only the matching pipeline, and runs the **compose smoke and e2e** job: build both images, boot the stack, run the smoke script, then reset the stack and run the Playwright journey |
| `api.yml` | Build, lint, unit tests, integration tests (real Postgres + Redis), coverage, schema drift, quality gate |
| `web.yml` | Build, lint, unit tests, coverage, quality gate |
| `llm-live.yml` | Opt-in, manual only: the one job that calls a real model |

The api and web pipelines each end in a quality gate that runs even when an upstream job
failed (`if: always()`): a secret scan, a dependency audit, and a check that
the scripts the pipeline depends on still exist.

### Dependency audit

`npm audit` cannot currently reach zero: the remaining advisories are transitive
and need prisma 7, vitest 5 or next 16, all major upgrades. Six baseline entries record them in
`.github/audit-baseline.json` with a reason and a review date, and
`scripts/audit-gate.mjs` fails the build on any **new** high or critical
advisory. Regenerate the baseline with:

```bash
node scripts/audit-gate.mjs --update
```

Removing an entry from the baseline does not fix anything — it only stops the
build complaining.

## Roadmap

Built vertically, one phase at a time; the plan with what each phase delivered
and how it was verified is `docs/specs/labops-copilot/PLAN.md`. All phases are
done.

| Phases | Contents |
|---|---|
| 0–4 | Config, audit trail, simulator, ingestion, queue and worker |
| 5–9 | Correlation, sign-in, AI investigation, policy engine, approval to verified resolution |
| 10–12 | Live updates, the opt-in real model, the operator dashboard |
| 13 | Integration settings and sealed secrets, adapter-gated (no live connector: the gate is closed) |
| 14 | Browser journey in CI, measured metrics |
| 15 | Delivery: one incident as one trace, the opt-in trace viewer, this walkthrough (local-only by decision) |

---

## Before production

Known and deliberate. Each is recorded in `docs/infra/INFRA.md`.

- **Behind a proxy, the login rate limit needs trusted client IPs.** Today it
  keys on the socket address, and dashboard sign-ins all arrive from the web
  server, so the 5-a-minute limit is effectively shared. Forward the client IP
  from the web server and set `trustProxy` to the real hops only.
- **API request logs carry no trace id** until HTTP spans are added; worker logs
  do.
- **Nothing alerts on a long open transaction.** The metric exists; the alert
  does not.
- **No live CloudLabs connector.** Built only after the API contract,
  credentials and a sandbox are confirmed (`ARCHITECTURE.md` section 13).
- **Not hosted.** Local-only by decision; the intended production shape is in
  `ARCHITECTURE.md` section 16.

---

## Non-goals

Deliberately out of scope for the MVP:

- Assuming access to Spektra's private systems or undocumented endpoints
- Real CloudLabs recovery execution, unless separately authorised and sandboxed
- Real Azure/AWS provisioning or destructive cloud operations
- Replacing CloudLabs or Cosmos, or a general-purpose lab creation platform
- Arbitrary command execution by an LLM
- Kubernetes or multi-service deployment
- Multiple cooperating AI agents without a clear need
- Production-scale claims from a local prototype

A live CloudLabs connector will only be implemented against verified official
documentation, supplied credentials and sandbox access. The provider-adapter
boundary exists so that adding it later does not change the pipeline. Until
then the simulator is the data source and the connection state reads
`not_configured`.

---

## License

Private project. All rights reserved.