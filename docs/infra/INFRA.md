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
| `web` (Next.js) | 3000 | Operator UI; holds the session cookie and calls the API server-side (BFF) | Exists |
| `api` (Fastify) | 4000 | HTTP API: validate, persist, enqueue; SSE | Exists |
| `worker` (BullMQ) | none | Runs queued jobs and the reconciler (startup, then every 60 s); never serves HTTP | Exists; runs correlation, investigations and recovery execution; also sweeps expired approvals |
| `postgres` 16 | 5432 | All durable business state | Exists |
| `redis` 7 | 6379 (host port overridable) | Queue transport; never the source of truth | Exists |
| `migrate` (one-shot) | none | Applies Prisma migrations, seeds the demo operator, then exits; api starts only after it succeeds | Exists |

Runtime: Node.js 22 (`.nvmrc`), npm workspaces (`apps/api`, `apps/web`).

The live Render deploy differs: one container runs the api, worker and web as
three processes; the API binds `127.0.0.1:4000` (unreachable from outside), the
web app listens on Render's `$PORT` (10000), Redis is Render Key Value and
PostgreSQL is Neon (18). See §7.

---

## 2. Local development

Two ways to run, for different jobs:

| Mode | Command | Use it for |
|---|---|---|
| Hot reload | `npm run db:up`, then `npm run dev` | Day-to-day development. Postgres and Redis run in Docker; the api, worker and web run on the host. |
| Full containers | `docker compose up --build` | Checking the reproducible stack the way CI and a reviewer see it. |

First-time setup:

```bash
npm install
npm run db:up                      # postgres and redis
cp apps/api/.env.example apps/api/.env
npm run db:generate                # Prisma client
npm run db:migrate                 # apply checked-in migrations
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
| web | `apps/web/Dockerfile` | Copies `.next`, `public/` and `next.config.mjs`; runs `next start`. The config is plain JS because the runtime image has no TypeScript: a `.ts` config made `next start` try to install it at boot and crash |
| render | `deploy/Dockerfile` | The live deploy's single image: builds both apps, carries the Prisma CLI for boot-time migrations, runs `deploy/start.sh` under `tini -g`. Not built in CI |

The worker reuses the api image with `node dist/worker.js` (same codebase,
different entrypoint), so there is no third Dockerfile.

**Compose networking gotcha.** Inside the `web` container, `localhost` is the web
container itself. Server-side code therefore uses `API_INTERNAL_URL`
(`http://api:4000`); `NEXT_PUBLIC_API_URL` (`http://localhost:4000`) is only its
fallback. The browser never calls the API: it talks to the web server, which
relays. `NEXT_PUBLIC_*` values are baked in at build time;
unprefixed variables are read at runtime and never reach the browser.

**Host port clashes.** Compose publishes 5432, 6379, 4000 and 3000 on the host.
If another project already holds 6379, set `REDIS_HOST_PORT=6380` in a root
`.env` (git-ignored; compose reads it) and point `REDIS_URL` in
`apps/api/.env` at that port. Likewise `WEB_HOST_PORT` moves the web app off
3000 (then pass the same port to the smoke script and the journey as
`WEB_URL`). Integration tests use Redis, so they must never
reach another project's instance.

---

## 4. Environment variables

**Today**

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | api | required (`.env.example`: `postgresql://labops:labops@localhost:5432/labops`) | PostgreSQL connection |
| `TEST_DATABASE_URL` | integration tests | `.../labops_test` | Database the integration and coverage runs use; must differ from `DATABASE_URL`. Created and migrated on each run |
| `API_HOST` | api | `127.0.0.1` (`0.0.0.0` in compose) | Bind address |
| `API_PORT` | api | `4000` | Port |
| `CORS_ORIGIN` | api | `http://localhost:3000` | Allowed browser origin |
| `LOG_LEVEL` | api | `info` | Pino level (test runs use `warn`) |
| `APPROVAL_TTL_MINUTES` | api, worker | `30` | How long an allowed proposal waits for approval before it expires |
| `LLM_PROVIDER` | worker | `fixture` | `fixture` (deterministic, offline) or `gemini` (real API). Default `fixture`, so no default run can reach a network model |
| `LLM_TIMEOUT_MS` | worker | `30000` | Enforced by our code, not the provider's |
| `LLM_API_KEY` | worker | unset | Required when `LLM_PROVIDER=gemini`; startup fails without it. Sent only as the `x-goog-api-key` header: never in a URL, log, prompt or `modelMetadata` |
| `LLM_MODEL` | worker | `gemini-3.1-flash-lite` | Chosen by measurement, not preference. The most volatile value here; override it |
| `LLM_BASE_URL` | worker | `https://generativelanguage.googleapis.com/v1beta` | Must be https, or http on a loopback host, because the key rides in a header |
| `LLM_MAX_ATTEMPTS` | worker | `3` | Total attempts against 429/5xx. The free tier throttles hard; a 400 is never retried |
| `CREDENTIALS_KEY` | api | unset (empty counts as unset) | base64 of exactly 32 bytes: the AES-256 key for integration credentials. Optional; when absent the settings page works and saving a credential returns 503 `CREDENTIALS_KEY_MISSING` rather than storing anything in the clear. Rotating it means re-sealing every stored credential; `keyVersion` on each row is what keeps that contained |
| `SESSION_COOKIE_SECURE` | api | `true` (`false` in compose and `.env.example`) | Session cookie only over https; off only for local http |
| `GOOGLE_CLIENT_ID` | api | unset | Optional Google sign-in. All four `GOOGLE_*` or none, else startup fails; empty counts as unset (compose passes them from the root `.env`) |
| `GOOGLE_CLIENT_SECRET` | api | unset | Sent only to Google's token endpoint; never returned, logged or sent to the web |
| `GOOGLE_REDIRECT_URI` | api | unset | Must match the OAuth client exactly; locally `http://localhost:3000/auth/google/callback`. https, or http on loopback |
| `GOOGLE_ALLOWED_EMAILS` | api | unset | Comma-separated exact emails, 1 to 100; no domain matching |
| `SEED_OPERATOR_USERNAME` | migrate (seed) | `operator` | Operator the seed creates or resets |
| `SEED_OPERATOR_PASSWORD` | migrate (seed) | unset: seeds nobody | 12+ characters; root `.env` for compose, a masked random value in CI; never committed |
| `DEMO_ENABLED` | api | `false` (`true` in the development compose and `.env.example`) | Registers `/api/demo/*`; when off the routes do not exist (404). `APP_ENV=production` refuses to start if this is true |
| `TRUST_PROXY_HOPS` | api, worker | unset | Trusted reverse-proxy hops, 0-10. `1` on Render (forced by `deploy/start.sh`), required by `APP_ENV=production`. It has nothing to act on today: the API is called only by the web server, which forwards no client address (§6 known gaps) |
| `APP_ENV` | api, worker | `development` | `production` enables the startup refusals: Secure cookie required, proxy hops required, demo routes must be off |
| `REDIS_URL` | api, worker | required; `redis://redis:6379` in compose | BullMQ transport |
| `QUEUE_PREFIX` | api, worker | `labops` | Namespaces queue keys; test runs use a unique `labops-test-*` prefix and clean it up |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | api, worker | unset | When set, spans export over OTLP/HTTP; unset, spans exist but are not exported |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` | API URL fallback (URLs only, never tokens) |
| `SESSION_COOKIE_SECURE` | web | `true` (`false` in compose) | The web origin's session cookie only over https; off only for local http |
| `API_INTERNAL_URL` | web | falls back to `NEXT_PUBLIC_API_URL` | API URL for server-side rendering |
| `DEMO_RESET_ON_BOOT` | Render boot | unset | `true` in `render.yaml` only: `prepare-demo.js` runs reset, migrate and seeds under a boot lock, dropping and reseeding the demo database when idle. Also needs `APP_ENV=production`; refuses non-simulated data |
| `DEMO_RESET_IDLE_MINUTES` | Render boot (`prepare-demo.js`) | `10` | 0 to 1440. A demo with an audit entry newer than this is kept; waking from sleep is always older. The deploy image smoke sets 0 to force a reset |
| `API_HEAP_MB`, `WORKER_HEAP_MB`, `WEB_HEAP_MB` | Render boot | `128`, `128`, `160` | Per-process heap caps so three Node processes fit in 512 MB |
| `PORT`, `RENDER_EXTERNAL_URL` | Render boot | set by Render | The web app listens on `PORT`; `CORS_ORIGIN` falls back to `RENDER_EXTERNAL_URL` |

The api parses and validates its variables at startup (`apps/api/src/platform/config/env.ts`),
so the process fails fast on bad configuration, and the error names the variable
without echoing its value. `.env` is git-ignored; `.env.example` holds
placeholders only.

### Running the live model check

```bash
npm run test:live -w @labops/api        # needs LLM_API_KEY in apps/api/.env
```

This is the only command in the repository that calls a network model. It is
excluded from `npm test`, and `.github/workflows/llm-live.yml` triggers on
`workflow_dispatch` only, so no push or pull request can start it.

If `LLM_API_KEY` is unset the suite reports as **skipped**, not passed, so it
can never be mistaken for coverage. A red run is usually the provider rather
than the code: the free tier returns 503 under load, and retired models answer
404 to new accounts.

---

## 5. Database and migrations

- Schema changes are checked-in migrations in `apps/api/prisma/migrations`,
  applied with `prisma migrate deploy` everywhere: `npm run db:migrate` locally,
  the `integration-test` CI job, the compose `migrate` service, and
  `deploy/start.sh` on every boot of the live deploy (inside the boot lock,
  via `prepare-demo.js`).
- New migration: edit `schema.prisma`, then
  `npm run prisma:migrate:dev -w @labops/api -- --name <change>`. Raw SQL for
  partial unique indexes, `CHECK` constraints and triggers goes in the
  generated file. `db push` is gone because it cannot express those.
- **Drift check:** CI runs `prisma:drift` after migrating, which exits 2 if
  `schema.prisma` differs from what the migrations produced.
- CI validates the schema in the api `build` job.

---

## 5a. Jobs: outbox, queue and reconciler

- A job row (`JobExecution`) is written **in the same transaction** as the work
  that needs it, then sent to Redis after commit (outbox). If Redis is down the
  event is still stored and the row stays `queued`.
- BullMQ `jobId` = the row's `jobKey` (e.g. `correlate-<window ms>`), so a
  burst of events for one window becomes one job. Finished jobs are removed
  from Redis; history lives in Postgres.
- A run that finishes after its key was re-armed (`generation` moved) leaves
  the row `queued` and queues one more run, so no work is dropped.
- The reconciler resends `queued`/`running` rows older than a 2-minute lease
  that Redis no longer has; past `MAX_ATTEMPTS` it fails and audits them.
- Inspect a job: `GET /api/jobs/:id` (from Postgres; payload never returned).
- A queue may define `onExhausted`, run in the transaction that fails a job
  for good (runner's last attempt or reconciler). The investigate queue uses it
  to send a stranded incident to `manual_review`.
- The correlate job holds a Postgres advisory lock (key `7316001`) for its
  transaction, so correlation runs one at a time across workers.

## 6. CI pipelines

Four workflows in `.github/workflows/`. Only `changes.yml` runs on pushes and pull
requests to `main`; it calls `api.yml` and `web.yml`. `llm-live.yml` is manual.

| Workflow | Role |
|---|---|
| `changes.yml` | The only entry point. Uses `dorny/paths-filter` to decide which service changed, then calls only the matching pipeline. The root `package.json`, lockfile and ESLint config fan out to both; `docker-compose.yml` counts for the api; a change only to workflows, top-level docs or the deploy files (`deploy/`, `render.yaml`, `scripts/`) runs neither. Also runs the **compose smoke and e2e** job whenever api or web changed: build the images, run `scripts/compose-smoke.sh`, then reset the stack (`down -v`, `up`) and run the Playwright journey (`npm run test:e2e -w @labops/web`); screenshots are uploaded only on failure, never traces, which hold cookies. |
| `api.yml` | build (`tsc` + `prisma validate`), lint and unit tests in parallel; then integration tests (real Postgres + Redis) and coverage; then the quality gate. Images are built by the compose smoke job whenever api or web changed |
| `web.yml` | build, lint and unit tests in parallel; then coverage; then the quality gate. Images are built by the compose smoke job whenever api or web changed |
| `llm-live.yml` | Manual only (`workflow_dispatch`): the one job that calls a real model; needs the `GEMINI_API_KEY` repository secret |

**Quality gate** (each pipeline, `if: always()` so it runs even after a failure):
1. Fails unless every upstream job succeeded.
2. `scripts/check-required-scripts.mjs`: the scripts CI depends on still exist.
3. `scripts/audit-gate.mjs`: fails on any *new* high or critical advisory not in
   `.github/audit-baseline.json`.
4. gitleaks secret scan.

**Integration tests:** `npm run test:integration -w @labops/api` runs
`*.int.test.ts` against `TEST_DATABASE_URL`, never the dev database: a dev or
compose worker's reconciler would otherwise pick up test job rows. The run
creates and migrates that database itself and refuses to start if it names the
same database as `DATABASE_URL`. Locally it reads `apps/api/.env` and needs
`npm run db:up`.

**Compose smoke test:** the CI job builds both images and boots the full stack;
`scripts/compose-smoke.sh` then checks the running stack: migrations exited 0, `/health` reports ok, the
web login page shows "API: ok" through `API_INTERNAL_URL`, a signed-out
dashboard request redirects to `/login`, and the demo scenario
runs and ingests events (at least 19 labs end up failed), `/api/labs` refuses
an anonymous request, the seeded operator signs in, the worker runs a correlate
job, the scenario's 12-lab incident exists, and the worker completes an
investigation of it with the fixture provider whose recommended retry policy
allows, then approves it and waits for the worker to verify every lab and
resolve the incident while the live stream, read through the web relay,
delivers the verification (checked on a fresh stack; a re-run skips it). It needs
`SEED_OPERATOR_PASSWORD` (the value compose seeded); CI generates a masked one
per run. It catches Dockerfile and
startup bugs that unit and integration tests cannot see. Run it locally against
a running stack with `scripts/compose-smoke.sh`.

**Coverage:** 70% lines, functions, branches and statements in both workspaces.
The api coverage job runs unit and integration specs together against a
migrated Postgres service container, so database code is measured, not
excluded; only the process entrypoints (`src/index.ts`, `src/worker.ts`,
`src/seed-operator.ts`, `src/seed-demo.ts`, `src/prepare-demo.ts`) are left out. The web job
excludes server components, which only E2E can reach.

**Known gaps**

| Gap | Fix | Phase |
|---|---|---|
| A transaction left open on the database holds back every live update until it finishes (the stream reads below the oldest running transaction) | Keep transactions short (they are). `oldestOpenTransactionMs` in `/api/metrics` now shows it; nothing alerts on it yet | Before production |
| Sign-in (5/min) and investigation (10/min) limits are global: every call reaches the API from the web server, which forwards no client address, so `TRUST_PROXY_HOPS` has nothing to act on | Forward `X-Forwarded-For` from the web server and count it as the trusted hop (a blanket trust lets clients spoof it). The API is already unreachable from outside on Render | Before production |
| `main` has no branch protection, so a PR can be merged before or despite failing checks | Require the CI checks in GitHub's branch rules; Render already refuses to deploy a failing commit (`checksPass`) | Owner |
| `main` has no branch protection | Require the quality gates before merge | Owner's settings change |
| Docs-only changes trigger no pipeline | Intended: `docs/**` is not in any filter | — |

---

## 7. Deployment

**See `DEPLOYMENT.md` in this folder** for the full runbook: why Render and
Neon, why not Vercel or Netlify, every configuration variable, the free-tier
limits, and what has and has not been verified. The summary:

**Render and Neon** (`render.yaml`, `deploy/`), at
https://labops.onrender.com. One container runs the API, worker and web app as
three processes, with Redis on Render Key Value and PostgreSQL on Neon. It
boots by resetting the demo database (`DEMO_RESET_ON_BOOT`), migrating, seeding
the `demo` operator and ingesting the demo scenario (`dist/seed-demo.js`), and
it sleeps after 15 minutes idle. `DEPLOYMENT.md` §0 has the costs and the steps.

**`APP_ENV=production` changes what the API accepts.** It refuses to boot if
`SESSION_COOKIE_SECURE` is not true (a Secure cookie over http is never sent,
so nobody could sign in), if `TRUST_PROXY_HOPS` is unset, or if `DEMO_ENABLED`
is true. `deploy/start.sh` sets all four after the platform's environment, so
a dashboard setting cannot contradict the production checks.

**Deploying.** Render deploys a push to `main` once every CI check on it
passes, the deploy image smoke included; there is no manual step and no image
registry. Migrations run at boot, before the processes start, inside the boot
lock, so a deploy's overlapping containers never migrate or reset at once.

**Backups and secrets.** There are no backups: a boot after 10 idle minutes
wipes and reseeds the demo database, so it never holds anything worth keeping. Secrets
(`DATABASE_URL`, `SEED_OPERATOR_PASSWORD`) are service variables in the Render
dashboard, and Render generates `CREDENTIALS_KEY`.

**Still not done for a public deployment:** no second instance or failover, no
uptime monitoring, and access control is a single shared operator password
until Google sign-in with an allow-list is configured (`AGENTS.md` §13a).
`docs/GAPS.md` §8 has the full list.

---

## 8. Observability infrastructure

| Signal | Today | Planned |
|---|---|---|
| Logs | Pino JSON to stdout; Fastify shares the instance; key-name redaction as a safety net; job logs carry `jobId` and `traceId`; correlation logs carry `incidentId` | `traceId` on API request logs needs HTTP spans (later) |
| Traces | All seven lifecycle spans; one incident is one trace across the api and the worker (`Incident.traceparent`, joined by the investigation and the approval). Opt-in viewer: `docker compose -f docker-compose.yml -f compose.tracing.yml up --build`, then Jaeger on `:16686` | `traceId` on API request logs needs HTTP spans |
| Metrics | `GET /api/metrics` and `GET /api/metrics/series` (failure timeline), shown as the overview's KPI tiles and charts; derived from committed rows over a window (1 h, 24 h or 7 d in the UI; max 168 h); see `ARCHITECTURE.md` section 12 | Indexes or a rollup table on the windowed columns if volume grows |
