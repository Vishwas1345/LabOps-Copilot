# Setup and configuration

Running LabOps Copilot locally, its configuration, and how the repository is
laid out. The project overview is the [README](../../README.md).

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
`REDIS_HOST_PORT` in a root `.env` if another project holds that port, and
`WEB_HOST_PORT` for the web app's 3000 under Docker Compose).

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
**Approve**, and watch it verify and resolve. Every `/api/*` route except
sign-in (password and Google) and the demo trigger needs a session.

For the faster dev loop, run `npm run db:up` for infrastructure only and
`npm run dev` for the API and web app with hot reload.

### Optional: sign in with Google

Password sign-in always works; Google is offered next to it once configured.

1. In Google Cloud Console, configure the OAuth consent screen (External,
   Testing) and add each person as a test user.
2. Create an OAuth client ID of type **Web application** with the authorised
   redirect URI `http://localhost:3000/auth/google/callback`, exactly.
3. Set the four variables in `apps/api/.env` (or the root `.env` for compose):

   ```bash
   GOOGLE_CLIENT_ID=<client id>
   GOOGLE_CLIENT_SECRET=<client secret>
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
   GOOGLE_ALLOWED_EMAILS=you@example.com
   ```

4. Restart the API. The sign-in page shows **Sign in with Google**.

Only emails on the allow-list, verified by Google, get in. The first sign-in
links the operator whose username is that email, or creates one with no
password. The web app needs no new variables: the secret never leaves the API.

---

## Environment variables

`apps/api/.env` — see `apps/api/.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required (`.env.example`: `postgresql://labops:labops@localhost:5432/labops`) | PostgreSQL connection string |
| `REDIS_URL` | required (`.env.example`: `redis://localhost:6379`) | BullMQ queues and the rate-limit store |
| `QUEUE_PREFIX` | `labops` | Namespaces queue keys; test runs use their own |
| `APP_ENV` | `development` | `production` refuses to start unless the cookie is Secure, `TRUST_PROXY_HOPS` is set and demo routes are off |
| `TRUST_PROXY_HOPS` | unset (trusts no proxy) | Proxy hops in front of the API; required in production |
| `DEMO_ENABLED` | `false` (`true` in `.env.example` and compose) | Registers `/api/demo/*`; when off those routes do not exist |
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
| `LLM_TIMEOUT_MS` | `30000` | Per model call, enforced by our code |
| `APPROVAL_TTL_MINUTES` | `30` | How long an approval stays valid before it expires |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (no export) | Where spans are sent, e.g. the opt-in Jaeger |
| `LOG_LEVEL` | `info` | Pino log level |
| `GOOGLE_CLIENT_ID` | unset | Optional Google sign-in; all four `GOOGLE_*` or none, empty counts as unset |
| `GOOGLE_CLIENT_SECRET` | unset | Stays on the API: sent only to Google's token endpoint, never returned or logged |
| `GOOGLE_REDIRECT_URI` | unset | `http://localhost:3000/auth/google/callback` locally; https, or http on loopback |
| `GOOGLE_ALLOWED_EMAILS` | unset | Comma-separated exact emails; nobody else can sign in with Google |
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

Per-process detail, and the deploy-only variables, are in
[`docs/infra/INFRA.md`](../infra/INFRA.md) §4. Real secrets are never committed;
`.env` is git-ignored.

Two limits are fixed in code rather than configured: sign-in (password and
Google) at 5 attempts a minute, and investigations at 10 a minute. Both are
effectively shared by every operator, because the browser only talks to the
web server and the web server forwards no client address to the API.

---

## Project structure

```
labops-copilot/
├── apps/
│   ├── api/                     Fastify API + BullMQ worker (Node.js/TS)
│   │   ├── prisma/              Data model and migrations
│   │   ├── src/
│   │   │   ├── index.ts, worker.ts, app.ts   Entrypoints: start here
│   │   │   ├── seed-operator.ts, seed-demo.ts, reset-demo.ts  One-shot jobs
│   │   │   ├── platform/        Cross-cutting: config, http, auth, audit,
│   │   │   │                    observability, secrets, jobs, events-stream
│   │   │   └── modules/         One folder per feature: labs, events,
│   │   │                        incidents, investigations, policies, recovery,
│   │   │                        integrations, metrics, demo. Most have
│   │   │                        routes.ts, schemas.ts, service.ts (or
│   │   │                        services/), and jobs/ where they run background
│   │   │                        work; policies/ is pure decision logic
│   │   └── test/                unit/, integration/, live/, fixtures/
│   └── web/                     Next.js operator dashboard
│       ├── src/                 app/ (pages), components/, lib/, middleware.ts
│       └── test/                unit/ (Vitest), e2e/ (Playwright journey)
├── deploy/                      Dockerfile and start.sh for the live
│                                single-container deploy
├── docs/                        Overview docs, dev/, infra/, specs/, images
├── scripts/                     compose-smoke, clean-db-check, audit-gate,
│                                check-required-scripts
├── .github/workflows/           CI pipelines
├── ARCHITECTURE.md              System architecture and trade-offs
├── CLAUDE.md, AGENTS.md         Rules and context for changing the code
├── docker-compose.yml           The full stack, for development
├── compose.tracing.yml          Opt-in Jaeger trace viewer
├── render.yaml                  The live deploy (Render Blueprint)
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
| `npm run test:live -w @labops/api` | The one opt-in test that calls a real model |
| `npm run seed:operator -w @labops/api` | Create or reset the operator from `SEED_OPERATOR_*` |
| `npm run seed:demo -w @labops/api` | Ingest the demo scenario where demo routes are off; safe to re-run |
| `scripts/clean-db-check.sh` | Integration tests twice on a throwaway database, then drop it |

### Checks before you commit

```bash
npm run lint && npm run typecheck && npm run test
```

CI runs the equivalent (a type-checking build, lint and unit tests per workspace), plus integration tests, coverage and a quality gate.
