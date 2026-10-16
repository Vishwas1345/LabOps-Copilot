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
| `CREDENTIALS_KEY` | api | unset | base64 of exactly 32 bytes: the AES-256 key for integration credentials. Optional; when absent the settings page works and saving a credential returns 503 `CREDENTIALS_KEY_MISSING` rather than storing anything in the clear. Rotating it means re-sealing every stored credential; `keyVersion` on each row is what keeps that contained |
| `SESSION_COOKIE_SECURE` | api | `true` (`false` in compose and `.env.example`) | Session cookie only over https; off only for local http |
| `GOOGLE_CLIENT_ID` | api | unset | Optional Google sign-in. All four `GOOGLE_*` or none, else startup fails; empty counts as unset (compose passes them from the root `.env`) |
| `GOOGLE_CLIENT_SECRET` | api | unset | Sent only to Google's token endpoint; never returned, logged or sent to the web |
| `GOOGLE_REDIRECT_URI` | api | unset | Must match the OAuth client exactly; locally `http://localhost:3000/auth/google/callback`. https, or http on loopback |
| `GOOGLE_ALLOWED_EMAILS` | api | unset | Comma-separated exact emails, 1 to 100; no domain matching |
| `SEED_OPERATOR_USERNAME` | migrate (seed) | `operator` | Operator the seed creates or resets |
| `SEED_OPERATOR_PASSWORD` | migrate (seed) | unset: seeds nobody | 12+ characters; root `.env` for compose, a masked random value in CI; never committed |
| `DEMO_ENABLED` | api | `false` (`true` in the development compose and `.env.example`) | Registers `/api/demo/*`; when off the routes do not exist (404). `APP_ENV=production` refuses to start if this is true |
| `TRUST_PROXY_HOPS` | api, worker | unset | Trusted reverse-proxy hops, 0-10. Set to 1 behind Caddy. Unset locally, which is correct: nothing proxies there |
| `APP_ENV` | api, worker | `development` | `production` enables the startup refusals: Secure cookie required, proxy hops required, demo routes must be off |
| `REDIS_URL` | api, worker | required; `redis://redis:6379` in compose | BullMQ transport |
| `QUEUE_PREFIX` | api, worker | `labops` | Namespaces queue keys; test runs use a unique `labops-test-*` prefix and clean it up |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | api, worker | unset | When set, spans export over OTLP/HTTP; unset, spans exist but are not exported |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` | API URL fallback (URLs only, never tokens) |
| `SESSION_COOKIE_SECURE` | web | `true` (`false` in compose) | The web origin's session cookie only over https; off only for local http |
| `API_INTERNAL_URL` | web | falls back to `NEXT_PUBLIC_API_URL` | API URL for server-side rendering |

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
  the `integration-test` CI job, and the compose `migrate` service.
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
| `changes.yml` | The only entry point. Uses `dorny/paths-filter` to decide which service changed, then calls only the matching pipeline. Root manifests and the ESLint config fan out to both; a change only to workflows or top-level docs runs neither. Also runs the **compose smoke and e2e** job whenever api or web changed: build the images, run `scripts/compose-smoke.sh`, then reset the stack (`down -v`, `up`) and run the Playwright journey (`npm run test:e2e -w @labops/web`); screenshots are uploaded only on failure, never traces, which hold cookies. |
| `api.yml` | build (`tsc` + `prisma validate`), lint and unit tests in parallel; then integration tests (real Postgres + Redis) and coverage; then the quality gate. Images are built by the compose smoke job on every change |
| `web.yml` | build, lint and unit tests in parallel; then coverage; then the quality gate. Images are built by the compose smoke job on every change |
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
`src/seed-operator.ts`) are left out. The web job
excludes server components, which only E2E can reach.

**Known gaps**

| Gap | Fix | Phase |
|---|---|---|
| A transaction left open on the database holds back every live update until it finishes (the stream reads below the oldest running transaction) | Keep transactions short (they are). `oldestOpenTransactionMs` in `/api/metrics` now shows it; nothing alerts on it yet | Before production |
| Dashboard logins all reach the API from the web server's IP, so the per-IP login limit is effectively global (5/min) | Forward the client IP from the web server and trust it only from that host, once the API is no longer reachable directly | Before production |
| Login rate limit keys on the socket IP (`trustProxy` off) | Behind a load balancer every client would share one IP, so set `trustProxy` to the real proxy hops only (a blanket `true` lets clients spoof `X-Forwarded-For`) | Before production |
| `main` has no branch protection | Require the quality gates before merge | Owner's settings change |
| Docs-only changes trigger no pipeline | Intended: `docs/**` is not in any filter | — |

---

## 7. Deployment

**See `DEPLOYMENT.md` in this folder** for the full runbook: why a single VM and
not Vercel or Netlify, every configuration variable, the free-tier risks, the
hostname options, what has and has not been verified, and the order of work
before it is genuinely public. The summary:

**Without a card: Render and Neon** (`render.yaml`, `deploy/render/`). One
container runs the API, worker and web app as three processes, with Redis on
Render Key Value and PostgreSQL on Neon. It boots by resetting the demo
database (`DEMO_RESET_ON_BOOT`), migrating, seeding the
`demo` operator and ingesting the demo scenario (`dist/seed-demo.js`), and it
sleeps after 15 minutes idle. `DEPLOYMENT.md` §0 has the costs and the steps.

**A single VM, deployed by hand.** `docker-compose.prod.yml` is a standalone
file, not an overlay on the development one, and the reason is recorded in its
header: compose merges sequences, so an overlay inherited the development file's
`ports:` on postgres, redis and web and published the database to the internet
while claiming it was private. Verified by reading back the rendered config —
only `proxy` publishes a port.

| Piece | What it does |
|---|---|
| `proxy` (Caddy) | The only published ports (80, 443). Issues and renews the certificate. Sets real client addresses. Disables response buffering on `/api/events/stream`, because a stream sending one event at a time would otherwise sit in the buffer indefinitely |
| `api`, `worker`, `web` | Built from the existing Dockerfiles, reachable from the compose network only |
| `postgres`, `redis` | No ports. Persistent volume for the database, in-memory for Redis (every key is a queue entry or a rate-limit counter, and both rebuild from Postgres) |
| `migrate` | One-shot, `restart: "no"` so a broken migration cannot loop and hold up every dependent service |

**`APP_ENV=production` changes what the API accepts.** It refuses to boot if
`SESSION_COOKIE_SECURE` is not true (a Secure cookie over http is never sent,
so nobody could sign in), if `TRUST_PROXY_HOPS` is unset (the rate limits key on
the client IP, and behind Caddy that must be the real one), or if `DEMO_ENABLED`
is true. Set by compose, not by `.env.production`, so a deploy cannot contradict
its own production checks.

**Deploying**, over SSH on the host:

```bash
git pull && ./scripts/deploy.sh          # backup, build, migrate, up, health-check
./scripts/deploy.sh --no-build           # roll out existing images
```

`deploy.sh` backs up before it builds and applies migrations before the new
containers start. That order is safe only because every migration so far is
additive; a migration that drops or renames a column needs expand-contract
instead. Roll back by checking out the previous sha and re-running it.

**Backups.** `scripts/backup.sh` writes a plain `pg_dump` to `./backups/` before
every deploy and keeps the seven newest, so a long-lived host cannot fill its own
disk. `scripts/restore.sh <dump>` proves a dump by restoring it into a scratch
database and counting rows, never into `labops` itself. **Run it once before you
need it:** an untested backup is not a backup. There is no off-host copy, so
losing the VM loses everything on it.

**Secrets.** `.env.production` on the host, mode 600, git-ignored along with
`backups/`. `.env.production.example` is placeholders only and is committed.
CI still builds both images on every change; there is no image registry and no
automated rollout, deliberately.

**`SITE_DOMAIN`, and why a domain is needed at all.** Automatic TLS works by
verifying control of a hostname over port 80, and browsers reject a certificate
issued for a bare IP. That is the only reason a hostname is required; nothing
here depends on owning it.

| Option | Cost | Note |
|---|---|---|
| Purchased domain | ~8-15/year | The only option with no caveat. Stable, and yours to point anywhere |
| IP-based resolver (`203-0-113-5.nip.io`, same on `sslip.io`) | Free | Works with this Caddyfile unchanged, because issuance uses the ordinary HTTP-01 challenge and needs only a hostname resolving to this machine. Shared by many sites, so a certificate can occasionally fail to issue; switching resolver usually fixes it |
| Permanent free subdomain (e.g. `yours.eu.org`) | Free | Yours forever, but approval is manual and takes days to weeks |
| Cloudflare tunnel | Free | No hostname needed at all, but the URL changes on every restart |

An Oracle Always Free instance gets a stable public IP for the life of the
instance, so the IP-based hostname stays valid; destroying and recreating the
instance changes the IP, and therefore the hostname.

Oracle's free tier also requires a card for verification, and free-tier capacity
is often unavailable in busy regions, so provisioning can need several attempts.

**Still not done for a public deployment:** no second host or failover, no
off-host backup, no uptime monitoring, and access control is a single shared
operator password until Google sign-in with an allow-list is configured
(`AGENTS.md` §13a). `docs/GAPS.md` §8 has the full list.

---

## 8. Observability infrastructure

| Signal | Today | Planned |
|---|---|---|
| Logs | Pino JSON to stdout; Fastify shares the instance; key-name redaction as a safety net; job logs carry `jobId` and `traceId`; correlation logs carry `incidentId` | `traceId` on API request logs needs HTTP spans (later) |
| Traces | All seven lifecycle spans; one incident is one trace across the api and the worker (`Incident.traceparent`, joined by the investigation and the approval). Opt-in viewer: `docker compose -f docker-compose.yml -f compose.tracing.yml up --build`, then Jaeger on `:16686` | `traceId` on API request logs needs HTTP spans |
| Metrics | `GET /api/metrics` and `GET /api/metrics/series` (failure timeline), shown as the overview's KPI tiles and charts; derived from committed rows over a window (1 h, 24 h or 7 d in the UI; max 168 h); see `ARCHITECTURE.md` section 12 | Indexes or a rollup table on the windowed columns if volume grows |
