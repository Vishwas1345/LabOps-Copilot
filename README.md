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

---

## Contents

- [Why this exists](#why-this-exists)
- [How it works](#how-it-works)
- [The safety model](#the-safety-model)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [API overview](#api-overview)
- [Demo scenario](#demo-scenario)
- [Testing](#testing)
- [Observability](#observability)
- [Roadmap](#roadmap)
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

---

## Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 15, React 19, TypeScript | Operator dashboard and workflows |
| Styling / UI | Tailwind CSS, shadcn/ui | Consistent interface components |
| Dependency graph | React Flow | Incident / lab / dependency relationships |
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

- Node.js 20+
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

This starts PostgreSQL on `localhost:5432`. Redis is added to the compose file
when the job queue lands.

### 3. Configure the environment

```bash
cp apps/api/.env.example apps/api/.env
```

Defaults match the compose credentials, so no edit is needed for local use.

### 4. Apply migrations and generate the client

```bash
npm run db:generate
npm run db:migrate
```

Schema changes are checked-in migrations under `apps/api/prisma/migrations`.
To create one after editing `schema.prisma`, run
`npm run prisma:migrate:dev -w @labops/api -- --name <change>`.

### 5. Run the app

```bash
npm run dev
```

This starts the API on `http://localhost:4000` and the web app on
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

The home page renders live API and database status.

### Docker Compose

The compose file is the reproducible baseline for local development and CI. It
runs PostgreSQL, Redis, a one-shot `migrate` service, the API and the web app.
The API starts only after migrations have applied:

```bash
docker compose up --build
```

For the faster dev loop, run `npm run db:up` for infrastructure only and
`npm run dev` for the API and web app with hot reload.

---

## Environment variables

`apps/api/.env` — see `apps/api/.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://labops:labops@localhost:5432/labops` | PostgreSQL connection string |
| `API_HOST` | `127.0.0.1` | API bind address |
| `API_PORT` | `4000` | API port |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed browser origin |

`apps/web/.env`:

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API base URL for the browser |
| `API_INTERNAL_URL` | falls back to `NEXT_PUBLIC_API_URL` | API base URL for server-side rendering; `http://api:4000` in Docker Compose |

Planned variables — encryption key for integration credentials, LLM provider
and model, Redis URL, log level, and demo-mode flag — will be added to
`.env.example` as their modules are implemented. Real secrets are never
committed; `.env` is git-ignored.

---

## Project structure

```
labops-copilot/
├── apps/
│   ├── api/                     Fastify API + BullMQ worker (Node.js/TS)
│   │   ├── prisma/schema.prisma Data model
│   │   └── src/                 Application source
│   └── web/                     Next.js operator dashboard
├── ARCHITECTURE.md              System architecture and trade-offs
├── docker-compose.yml           Local infrastructure
└── package.json                 npm workspaces + root scripts
```

### Root scripts

| Script | Action |
|---|---|
| `npm run dev` | Run API and web together |
| `npm run dev:api` | Run the API only |
| `npm run dev:web` | Run the web app only |
| `npm run db:up` | Start PostgreSQL via Docker Compose |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Apply checked-in migrations to the database |
| `npm run lint` | ESLint across both workspaces |
| `npm run lint:fix` | ESLint with autofix |
| `npm run typecheck` | Type check both workspaces |
| `npm run test` | Vitest unit tests, both workspaces |
| `npm run test:integration -w @labops/api` | API integration tests against a real, migrated PostgreSQL |
| `npm run coverage` | Vitest with v8 coverage and 70% thresholds |

### Checks before you commit

```bash
npm run lint && npm run typecheck && npm run test
```

CI runs the same three, plus coverage and a quality gate.

---

## API overview

Illustrative surface. Implemented endpoints are marked ✅.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Service and database status ✅ |
| `GET` | `/api/labs` | List labs; `status` filter, cursor pagination (`limit` 1–100) ✅ |
| `GET` | `/api/labs/:id` | Lab with its dependency ids ✅ (recent events arrive with ingestion, Phase 3) |
| `POST` | `/api/events` | Ingest a normalized operational event |
| `GET` | `/api/incidents` | List and filter incidents |
| `GET` | `/api/incidents/:id` | Incident, affected labs and evidence |
| `POST` | `/api/incidents/:id/investigate` | Queue an AI investigation |
| `POST` | `/api/incidents/:id/recovery-proposals` | Create a policy-validated proposal |
| `POST` | `/api/recovery-actions/:id/approve` | Approve a proposed action |
| `POST` | `/api/recovery-actions/:id/reject` | Reject a proposed action |
| `GET` | `/api/jobs/:id` | Background job state |
| `GET` | `/api/incidents/:id/audit` | Incident audit history |
| `GET` | `/api/events/stream` | SSE stream for live dashboard updates |
| `GET` | `/api/integrations` | Configured integrations and status |
| `POST` | `/api/integrations/cloudlabs/test` | Test connection settings, never returns secrets |
| `PUT` | `/api/integrations/cloudlabs` | Create/update connection configuration |
| `DELETE` | `/api/integrations/cloudlabs` | Disconnect and revoke stored credentials |
| `POST` | `/api/integrations/cloudlabs/sync` | Trigger a manual sync, if supported |
| `POST` | `/api/integrations/cloudlabs/webhooks` | Receive verified webhook deliveries |
| `GET` | `/api/integrations/cloudlabs/deliveries` | Recent redacted delivery outcomes |
| `POST` | `/api/demo/scenarios/:name` | Create a seeded scenario's labs (`training-event`); idempotent per seed; only when `DEMO_ENABLED` ✅ |

All request bodies are validated. A consistent error envelope is used
throughout. Demo endpoints are disabled outside local and demo environments.

---

## Demo scenario

The intended walkthrough, built on a fixed seed so it is reproducible every
time:

1. Create 20–50 simulated labs.
2. Trigger a scenario containing a cluster of failures sharing one simulated
   dependency, a few unrelated permission failures, and a duplicate event.
3. Show that the shared failures correlate into one incident *with rationale*,
   while the unrelated permission failures stay separate.
4. Open the incident and inspect the correlation explanation, affected labs and
   evidence.
5. Run the AI investigation; review the hypothesis, supporting evidence,
   missing evidence and stated uncertainty.
6. Approve one permitted recovery action — it executes in the worker and
   verifies successfully.
7. Attempt a second action that fails a precondition — it is blocked, and the
   audit trail records which rule stopped it.
8. Confirm the audit history records every transition, with the SSE stream
   showing live updates throughout.

This is scripted in `apps/api` under the demo scenario module as it is built.

---

## Testing

Test layers, each mirroring an architectural boundary so a failure points
directly at a boundary. Unit and integration suites exist today; the scopes
below grow phase by phase (see `docs/specs/labops-copilot/PLAN.md`), and
Playwright arrives in Phase 14:

| Layer | Scope |
|---|---|
| Unit | Normalisation, dedup, correlation scoring, state transitions, policy decisions, retry and idempotency handling, AI output schema validation |
| Integration | Ingestion into PostgreSQL, ingestion triggering a BullMQ job, worker failure and retry, approval and policy enforcement, recovery execution and verification, audit entry creation |
| E2E (Playwright) | The full operator journey above |
| Contract | Provider capability reporting, LLM output schema, webhook normalisation |

Principles: the LLM is mocked in CI so no test depends on a live model; a fixed
seed produces an identical scenario each run; no test asserts on wall-clock
timings or generated prose. The negative cases are first-class — unrelated
failures must not merge, malformed model output must be rejected, disallowed
actions must be blocked, duplicate approvals must not double-execute, stale
approvals must be revalidated, and no test output may contain a secret.

---

## Observability

Structured JSON logs via Pino. Fastify shares the same logger instance, and
every log object passes through a key-name redaction step (any depth, any
casing) as a safety net behind redaction at the point where data enters. It
matches secret-shaped key names such as `token`, `apiKey` or `password`; a
secret logged under an innocuous key or inside a free-text message is not
caught. OpenTelemetry spans follow the incident
across process boundaries:

```
event.ingest → incident.correlate → investigation.queue → investigation.llm
             → recovery.policy_check → recovery.execute → recovery.verify
```

Trace context is embedded in job payloads, so a single incident resolves to a
single trace even though it spans processes and minutes.

Metrics: events ingested, candidate incidents created, correlation duration,
queue depth and job latency, AI success/failure and latency, recovery success
rate, retry count, time to first incident, and time from approval to verified
outcome.

Demo numbers come from actual runs of this prototype. No performance claims are
fabricated.

---

## Continuous integration

Three workflows under `.github/workflows/`:

| Workflow | Role |
|---|---|
| `changes.yml` | Detects whether a commit touched `apps/web`, `apps/api`, or shared root tooling, then dispatches only the matching pipeline |
| `api.yml` | build, lint, unit tests, integration tests (real Postgres + Redis), coverage, quality gate |
| `web.yml` | build, lint, unit tests, coverage, quality gate |

A change confined to the frontend never starts the backend pipeline. Changes to
the root manifests or the ESLint config fan out to both, since shared tooling
can break either service.

Every service pipeline ends in a quality gate that runs even when an upstream
job failed (`if: always()`) — a gate that only runs when everything passed can
never catch anything. The gate performs a secret scan, a dependency audit, and
a check that the scripts the pipeline depends on still exist.

### Dependency audit

`npm audit` cannot currently reach zero: six advisories require prisma 7, vitest
5 or next 16, all major upgrades. Those six are recorded in
`.github/audit-baseline.json` with a reason and a review date, and
`scripts/audit-gate.mjs` fails the build on any **new** high or critical
advisory. Regenerate the baseline with:

```bash
node scripts/audit-gate.mjs --update
```

Removing an entry from the baseline does not fix anything — it only stops the
build complaining.

## Roadmap

Built vertically so a working end-to-end workflow exists early. The full
phase-by-phase plan, with what each phase delivers and how it is verified, is
`docs/specs/labops-copilot/PLAN.md`.

| Phases | Contents | State |
|---|---|---|
| 0 | Config validation, error envelope, migrations, integration-test gate | Done |
| 1–5 | Audit trail, simulator, event ingestion, queue and worker, correlation | Not started |
| 6–9 | Operator auth, AI investigation, policies, approval, execution, verification | Not started |
| 10–12 | Live updates, real LLM provider, operator dashboard | Not started |
| 13–15 | Integration settings, E2E tests and metrics, delivery | Not started |

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