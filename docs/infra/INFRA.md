# Infrastructure

How LabOps Copilot runs locally, in containers and in CI. Each section separates
what **exists today** from what is **planned**, and names the plan phase
(`docs/specs/labops-copilot/PLAN.md`) that adds it. Design rationale lives in
`ARCHITECTURE.md §3` (runtime topology) and `§16` (deployment); this file is the
operational reference.

---

## 1. Processes and ports

| Process | Port | Role | Status |
|---|---|---|---|
| `web` (Next.js) | 3000 | Operator UI; server components call the API | Exists |
| `api` (Fastify) | 4000 | HTTP API: validate, persist, enqueue; SSE | Exists (`/health`, `/api/labs`) |
| `worker` (BullMQ) | none | Correlation, investigation, recovery, verification; never serves HTTP | Planned, Phase 4 |
| `postgres` 16 | 5432 | All durable business state | Exists |
| `redis` 7 | 6379 | Queue transport and SSE pub/sub; never the source of truth | Runs in compose; first used in Phase 4 |
| `migrate` (one-shot) | none | Applies Prisma migrations before api/worker start | Planned, Phase 0 |

Runtime: Node.js 22 (`.nvmrc`), npm workspaces (`apps/api`, `apps/web`).

---

## 2. Local development

Two ways to run, for different jobs:

| Mode | Command | Use it for |
|---|---|---|
| Hot reload | `npm run db:up`, then `npm run dev` | Day-to-day development. Postgres runs in Docker; api and web run on the host. |
| Full containers | `docker compose up --build` | Checking the reproducible stack the way CI and a reviewer see it. |

First-time setup:

```bash
npm install
npm run db:up                      # postgres only
cp apps/api/.env.example apps/api/.env
npm run db:generate                # Prisma client
npm run db:push                    # becomes `db:migrate` in Phase 0
npm run dev                        # api :4000 + web :3000
```

---

## 3. Containers

Both images are multi-stage builds from the repo root (the workspace lockfile
lives there): a `build` stage with all dependencies, and a `runtime` stage with
production dependencies only, running as the non-root `node` user.

| Image | Dockerfile | Notes |
|---|---|---|
| api | `apps/api/Dockerfile` | Generates the Prisma client at build time and copies it into the runtime stage |
| web | `apps/web/Dockerfile` | Copies `.next`, `public/` and `next.config.ts`; runs `next start` |

The worker will reuse the api image with a different command (same codebase,
different entrypoint), so there is no third Dockerfile.

**Compose networking gotcha.** Inside the `web` container, `localhost` is the web
container itself. Server-side code therefore uses `API_INTERNAL_URL`
(`http://api:4000`), while the browser uses `NEXT_PUBLIC_API_URL`
(`http://localhost:4000`). `NEXT_PUBLIC_*` values are baked in at build time;
unprefixed variables are read at runtime and never reach the browser.

---

## 4. Environment variables

**Today**

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | api | `postgresql://labops:labops@localhost:5432/labops` | PostgreSQL connection |
| `API_HOST` | api | `127.0.0.1` (`0.0.0.0` in compose) | Bind address |
| `API_PORT` | api | `4000` | Port |
| `CORS_ORIGIN` | api | `http://localhost:3000` | Allowed browser origin |
| `LOG_LEVEL` | api | `info` | Pino level |
| `REDIS_URL` | api | `redis://redis:6379` in compose | Set, not yet read |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` | API URL for the browser (URLs only, never tokens) |
| `API_INTERNAL_URL` | web | falls back to `NEXT_PUBLIC_API_URL` | API URL for server-side rendering |

**Planned**

| Variable | Phase | Purpose |
|---|---|---|
| `DEMO_ENABLED` | 2 | Registers `/api/demo/*`; off outside local and demo |
| `SESSION_SECRET` | 6 | Signs operator session cookies |
| `APPROVAL_TTL_MINUTES` | 9 | Approval expiry (default 30) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 4 | Trace export target |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_MS` | 11 | Model provider; `fixture` by default |
| `CREDENTIALS_KEY` | 13 | Encryption key for stored integration credentials |

All variables are parsed and validated at startup from Phase 0 on, so the process
fails fast on bad configuration. `.env` is git-ignored; `.env.example` holds
placeholders only.

---

## 5. Database and migrations

- **Today:** `prisma db push` applies `apps/api/prisma/schema.prisma` directly.
  There are no migration files.
- **Phase 0:** switch to `prisma migrate` with migrations checked in. This is
  required, not optional: partial unique indexes (one open incident per
  correlation window), `CHECK` constraints and the append-only trigger on
  `AuditEntry` need raw SQL that `db push` cannot express.
- CI validates the schema in the api `build` job and applies it in the
  `integration-test` job against a real Postgres service container.

---

## 6. CI pipelines

Three workflows in `.github/workflows/`. Triggered on pushes and pull requests to
`main`.

| Workflow | Role |
|---|---|
| `changes.yml` | The only entry point. Uses `dorny/paths-filter` to decide which service changed, then calls only the matching pipeline. Root manifests and the ESLint config fan out to both. |
| `api.yml` | build (`tsc` + `prisma validate`), lint and unit tests in parallel; then integration tests (real Postgres + Redis) and coverage; then the quality gate; then the image (only when `deploy` is set) |
| `web.yml` | build, lint and unit tests in parallel; then coverage; then the quality gate; then the image (only when `deploy` is set) |

**Quality gate** (each pipeline, `if: always()` so it runs even after a failure):
1. Fails unless every upstream job succeeded.
2. `scripts/check-required-scripts.mjs`: the scripts CI depends on still exist.
3. `scripts/audit-gate.mjs`: fails on any *new* high or critical advisory not in
   `.github/audit-baseline.json`.
4. gitleaks secret scan.

**Coverage:** 70% lines, functions, branches and statements in both workspaces.
Entry points and wiring that only integration or E2E tests can reach are
excluded, each with a comment saying why.

**Known gaps**

| Gap | Fix | Phase |
|---|---|---|
| `test:integration` does not exist, so the integration job passes without running anything (`--if-present`) | Add the script and make it required in `check-required-scripts.mjs` | 0 |
| Nothing sets the `deploy` input, so images are never built in CI | Add a release trigger once a deployment target exists | 15 |
| No Playwright job | Compose up, then run the journey | 14 |
| `main` has no branch protection | Require the quality gates before merge | Settings change; do it before Phase 1 |
| Docs-only changes trigger no pipeline | Intended: `docs/**` is not in any filter | — |

---

## 7. Deployment

No deployment target is chosen yet (Phase 15). The intended production shape
(`ARCHITECTURE.md §16`): the same containers, managed Postgres and Redis, TLS at
the edge, secrets from the platform's secret store, OTel export to a collector,
demo endpoints disabled, and an app database role limited to its own schema.

---

## 8. Observability infrastructure

| Signal | Today | Planned |
|---|---|---|
| Logs | Pino JSON to stdout; Fastify shares the instance; key-name redaction as a safety net | Child loggers with `correlationId` / `traceId` / `incidentId` (Phase 4) |
| Traces | None | OTel SDK in api and worker, trace context carried in job payloads (Phase 4) |
| Metrics | None | OTel counters and histograms from real runs only (Phase 14) |
