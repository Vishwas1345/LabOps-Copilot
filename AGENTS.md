# AGENTS.md: LabOps Copilot handoff and operating guide

For any coding agent (OpenCode, Claude Code, others) continuing this project.
Read this first, then `CLAUDE.md`, which is the full rulebook and wins on any
conflict. This file adds what the rulebook cannot: **how we have been working,
what is built, what is in flight, and what to do next.**

Last updated: 2026-10-14, end of the day's session (Phases 5-10 and 12 built).

---

## 1. What this project is

LabOps Copilot is an AI-assisted incident response and recovery coordination
prototype for cloud lab operations (a companion concept for a CloudLabs-style
platform; never imply Spektra lacks any capability). **All lab infrastructure
is simulated**; nothing touches a real cloud resource, and the UI says so on
every page.

The workflow, which now runs end to end in the browser:

```
simulated lab failures -> events ingested (validated, redacted, deduped)
  -> deterministic correlation into explainable incidents
  -> AI investigation (fixture model; output is untrusted input)
  -> deterministic policy (7 fixed steps) -> proposal awaiting approval
  -> human approval -> worker re-checks policy against fresh state
  -> simulated recovery -> verification (every lab ready) -> resolved
  -> every step in an append-only audit trail, streamed live to the dashboard
```

**The one architectural fact that matters most:** the LLM proposes, deterministic
code decides, a human approves. No path from model output to an executor may
skip schema validation, policy and approval.

Docs: `CLAUDE.md` (rules), `ARCHITECTURE.md` (design, with "How Phase N
implements it" sections), `docs/specs/labops-copilot/SPEC.md` (what and why),
`docs/specs/labops-copilot/PLAN.md` (phase plan, status line, and a recorded
**deviations** paragraph per phase), `docs/infra/INFRA.md` (processes, env,
CI, known gaps), `README.md` (setup, endpoints, roadmap). The git-ignored
`LabOps_Copilot_Project_Specification-2.md` at the root is internal context:
**never copy it into any tracked file.**

## 2. Stack (fixed; no substitutions)

Node.js + TypeScript only (never a Python service). API: Fastify 5. Web:
Next.js 15 App Router + React 19, Tailwind v4 + shadcn/ui. Zod for every
boundary. Prisma 6 + PostgreSQL 16. Redis 7 + BullMQ. SSE (not WebSockets).
Pino logs, OpenTelemetry traces. Vitest (unit + integration), Playwright (E2E,
Phase 14). Docker Compose, GitHub Actions. Excluded unless a current
requirement appears: Kubernetes, Kafka, vector DBs, LangGraph, a second agent
framework. **Every new dependency needs a one-line "why the toolchain cannot
do it".**

## 3. How we work (the owner's expectations, followed all day)

**Plan first, implement second.** For anything touching more than one file,
adding a dependency, changing an API/schema, or with more than one reasonable
approach:

1. Restate the problem in one or two plain sentences.
2. Give 2-3 options with cost/risk, a recommendation and **why**, plus: how it
   scales at 10x, how it is secure (trust boundary, validation, what could
   leak), and the simplest version that fully covers the need.
3. **Wait for the owner's "go"** (they often answer "go" or pick an option).
4. Implement in small steps. Trivial one-liners: state what and why, then do it.

**Communication style:** honest, no sugarcoating, lead with the uncomfortable
part (bad news first). Simple explanation first, then detail. Never
over-engineer. Every decision carries its "why". Say "unsure" when unsure;
never claim a verification that did not happen (see section 6 for the times we
got this wrong and corrected it). The owner likes each reply to end with two
short blocks: **Learning:** (1-3 lines on what was non-obvious) and **Next
steps:**.

**Per-phase delivery loop:**

1. Read the phase in `PLAN.md` and its Jira subtasks; plan; get "go".
2. Branch from `main`: `feat/LOC-<story>-<slug>` (fixes: `fix/<slug>`).
   Move the Jira story to In Progress.
3. Implement; **one commit per subtask**, Conventional Commits, imperative
   lowercase subject, body explaining why. Never commit to `main`.
4. Every behaviour ships with tests, including the negative case. **Mutation-
   check each safety test**: break the guard, confirm a test fails, restore
   (keep a backup copy; verify with `diff`/`git status` that it is restored).
   If a mutation is not caught, write a test that forces it (we repeatedly
   found "race" tests that never actually overlapped; force overlap with a
   held row lock plus `pg_stat_activity` wait polling, see
   `apps/api/src/recovery/incident.fixture.ts` `untilBlocked`).
5. Update docs in the same PR: `PLAN.md` status line + a "Phase N deviations"
   paragraph, `ARCHITECTURE.md`, `README.md`, `INFRA.md`.
6. Run the full verification routine (section 5).
7. **Adversarial self-review** of the whole diff before calling it ready:
   prove each suspect with a throwaway probe test (`src/probe.int.test.ts`,
   deleted afterwards). Open the PR as a **draft**, report findings with
   proposed fixes, and **wait for "go"** before fixing. Every phase so far had
   at least one real finding this way.
8. Fixes land as separate `fix(...)` commits with a regression test; re-run
   the routine; update the PR body ("Self-review fixes"); `gh pr ready`.
9. Jira: subtasks Done, story In Testing, a comment with PR link,
   deviations, verification numbers.
10. **The owner merges** (`gh pr merge N --rebase`, never `--delete-branch`;
    branches are kept). Then pull `main`, move the story to Done.

## 4. Non-negotiable rules (condensed from CLAUDE.md)

- **AI boundary:** model output is untrusted; strict Zod (unknown keys
  rejected, closed enums, bounded strings); no field for approval/authority;
  targets intersected with the incident's labs; evidence assembled
  server-side, capped, redacted, metadata excluded, inside an escaped
  `<evidence>` block; model failure is recorded, not thrown, and never
  damages state.
- **Actions** are a closed allow-list (`RETRY_PROVISIONING`,
  `RECHECK_DEPENDENCY`, `RERUN_VALIDATION`, `ESCALATE_MANUAL`). Adding one means
  the enum (`labs/actions.ts` + DB enum), `policies/actions.ts`, and the
  `ARCHITECTURE.md §10` table **in the same change** (a test enforces the sync).
  No generic "run this" path, ever. No action accepts parameters.
- **Policy order is fixed**: structural, target, state, concurrency, rate
  limit, authorisation, idempotency. Proposals run 1-5, execution re-runs 3-7.
- **Approval is permission to re-check, not to execute.** Resolve only when
  verification passes (every lab in the incident `ready`).
- **State machines are data** (`*_TRANSITIONS`); every status change goes
  through `transitionLab` / `transitionIncident` (compare-and-set + audit in
  the same transaction).
- **Invariants in the database** (unique keys, partial unique indexes,
  `FOR UPDATE`, compare-and-set), not application checks.
- **Audit is append-only** (DB trigger). Never store raw user input there
  (failed logins record the resolved operator id or `unknown`, never the
  typed username).
- **Secrets:** never logged, never returned, never in a prompt or URL;
  redaction at the boundary (`observability/redact.ts`); `.env` files are
  git-ignored; `.env.example` holds placeholders only.
- **Modules own their tables** and expose functions; dependency direction is
  downward: `investigations -> recovery -> policies(pure, imports only labs)`,
  `recovery -> incidents -> events -> labs`; `audit`, `observability`,
  `config`, `auth`, `jobs` are cross-cutting. No upward imports.
- **Deny by default:** every API route needs a session unless it sets
  `config: { public: true }`; a test requests every registered route
  anonymously. Human audit actors come from `actorOf(request)`.
- **The browser talks only to the web server (BFF).** It holds the session in
  its own httpOnly cookie and forwards it to the API over `API_INTERNAL_URL`.
  CORS credentials stay off.
- **No fabricated numbers.** Metrics come from real runs only.
- Code style: TS strict, no `any`, ESM `.js` import suffixes in the API, short
  why-comments (1-3 lines, top of file or before a non-obvious function;
  safety decisions always commented), no dead code, no emojis.

## 5. Verification routine (run before every push; report results honestly)

Check disk first: `df -h /`. **Under 5 GB free, stop and ask the owner to run
`docker builder prune -f`** (a full disk once crashed Docker and the session).

1. `npm run lint`, `npm run typecheck`, `npm run test` (both workspaces).
2. `npm run test:integration -w @labops/api` (real Postgres + Redis).
3. `scripts/clean-db-check.sh`: integration suite **twice** on a throwaway
   database, then dropped. **Never** `prisma migrate reset` (Prisma blocks it
   for agents, and it would wipe dev data).
4. `npm run coverage -w @labops/api` and `-w @labops/web` (70% thresholds;
   never add exclusions to pass; test the code instead).
5. Fresh clone: `git clone . <scratch>/fresh -b <branch>`, `npm ci`,
   `npm run db:generate`, lint, typecheck, test, both builds, web coverage,
   API integration against a brand-new DB
   (`TEST_DATABASE_URL=postgresql://labops:labops@localhost:5432/labops_fresh_clone REDIS_URL=redis://localhost:6380`),
   then delete the clone and drop that DB.
6. Typecheck **every commit** on the branch:
   `for c in $(git rev-list --reverse main..HEAD); do git checkout -q $c && rm -rf apps/web/.next && npm run typecheck; done`
   (clear `.next`: stale generated types make old commits fail falsely).
7. Compose smoke on a **fresh, freshly built** stack:
   ```
   set -a; . ./.env; set +a
   docker compose down                      # dev data volume is kept
   COMPOSE_PROJECT_NAME=labops-smoke docker compose up --build -d
   COMPOSE_PROJECT_NAME=labops-smoke scripts/compose-smoke.sh
   COMPOSE_PROJECT_NAME=labops-smoke docker compose down -v
   docker compose up --build -d             # dev stack back
   ```
   **Always `--build`**: compose names images per project, so a throwaway
   project otherwise runs stale images (this once produced a false
   "verified"). Check image build times if in doubt.

The smoke test covers: migrate, health, web login page shows `API: ok`,
signed-out redirect, demo scenario (201 fresh / 200 replay), anonymous 401,
sign-in, correlation, investigation, policy-allowed proposal, approval,
verified resolution, and the live stream (through the web relay) delivering
the verification event. It passes on a fresh stack and on a re-run.

## 6. Environment facts and gotchas (all learned the hard way)

- **Local Redis is on host port 6380**, because another project owns 6379:
  root `.env` has `REDIS_HOST_PORT=6380`; `apps/api/.env` has
  `REDIS_URL=redis://localhost:6380`.
- **Integration tests use their own database** (`TEST_DATABASE_URL`, e.g.
  `labops_test`); the run creates and migrates it and refuses to start if it
  equals `DATABASE_URL`. Never point tests at the dev DB.
- **Demo operator:** compose's `migrate` service seeds `operator` from the
  **root** `.env` `SEED_OPERATOR_PASSWORD` (12+ characters, git-ignored).
  `apps/api/.env.example` is only a template; nothing reads it. To change the
  password: edit root `.env`, then `docker compose up -d migrate` (log shows
  `outcome":"updated"`; re-seeding with the same password is a no-op).
  `npm run seed:operator -w @labops/api` does the same for the host dev loop.
- Login is rate limited to 5/min per client IP, and all dashboard logins come
  from the web server's IP, so it is effectively **global** (known gap). Too
  many attempts shows "Too many sign-in attempts"; wait a minute. The audit
  trail (`auth.login` entries) tells "unknown username" from "wrong password".
- **Prisma queries are lazy:** `void prisma.x.update(...)` never runs. Always
  await (one test silently did nothing because of this).
- **Never edit an applied migration** (Prisma checksums it); add a new one.
  `npm run prisma:drift -w @labops/api` must stay clean.
- zsh: `grep --include=*.ts` fails on glob expansion; use plain `grep -rn`.
- The automation browser in our session could not reach `localhost:3000`; UI
  checks were done by rendering pages with a real session cookie via curl.
  Server components are not unit-testable here; Playwright (Phase 14) covers
  them.
- gitleaks runs in CI on each push's commits; fake secrets in tests must be
  allowlisted **by exact string** in `.gitleaks.toml` (never by pattern).
- `scripts/audit-gate.mjs` fails on new high/critical npm advisories not in
  `.github/audit-baseline.json`.
- Main is **not** branch-protected yet (owner's settings task: require the
  api/web quality gates and the compose smoke test).

## 7. What is built (phase by phase)

All merged to `main` except Phase 10 (PR #16, draft). Jira: story for Phase N
is `LOC-(5+N)`.

| Phase | Jira | PR | What |
|---|---|---|---|
| 0-4 | LOC-5..9 | #3,#4,#6,#7,#8 | Config/errors/migrations; audit trail + lab model; deterministic simulator + demo; event ingestion (validate, redact, dedupe); BullMQ queue, outbox job rows, reconciler, OTel traces |
| 5 | LOC-10 | #9 | Deterministic correlation: scoring (0.70 threshold), anchor-based clustering, advisory-locked correlate job, incident read APIs |
| test-db | — | #10 | Integration tests on their own database |
| 6 | LOC-11 | #11 | Operator auth: server-side sessions (SHA-256 of a random token), deny-by-default guard, scrypt, login rate limit, idempotent seed |
| 7 | LOC-12 | #12 | AI investigation: bounded redacted evidence, escaped prompt, strict output schema, fixture provider, non-destructive failure, shape-based secret redaction |
| 8 | LOC-13 | #13 | Policy engine: allow-list as data, pure 7-step evaluator, recorded proposals, one starting state per proposal source |
| 9 | LOC-14 | #14 | Approve/reject (row lock, expiry), execute (revalidate, simulate outside tx, verify all labs), expiry sweep, end-to-end backend test |
| 12 | LOC-17 | #15 | Dashboard (run **before** 10 and 11 by agreement): BFF login, overview, incidents, incident detail with approve/reject, audit; Zod-parsed responses |
| 10 | LOC-15 | **#16 draft** | Live updates over SSE (see section 8) |

Key behaviours worth knowing (details in `ARCHITECTURE.md`):

- Incident states: `open -> investigating -> awaiting_approval -> recovering ->
  resolved`, plus `manual_review`. A diagnosis proposes from `investigating`
  (in the investigation's own transaction); an operator proposes only from
  `manual_review` (`manual_review -> awaiting_approval` was added). Any
  failure or block goes to `manual_review` or back to `open`.
- Jobs: outbox rows in Postgres (`JobExecution`) + BullMQ; `onExhausted`
  hooks (runner's last attempt and the reconciler) settle domain state.
- Execute job: tx1 re-runs policy 3-7 (own row excluded from concurrency) and
  marks running; simulated retry runs outside any tx (one outcome table,
  `labs/recovery-simulator.ts`); tx2 compare-and-sets on `running`, moves only
  labs still `recovering` (event evidence wins), verifies every incident lab.
- Live feed (Phase 10): `AuditEntry.txid` (`xid8`, DB-set); the stream reads
  rows below `pg_snapshot_xmin` (oldest running transaction) so delivery is
  gap-free even when transactions commit out of `seq` order; the SSE id is that
  boundary; `Last-Event-ID` replays exactly the gap; >500 behind gets `reset`;
  one poller per API process; heartbeat re-checks the session; web relays the
  stream (`app/api/events/stream/route.ts`) and `LiveRefresh` refreshes pages.

Latest verified numbers (Phase 10 branch): API unit 543, integration 170
(twice on a fresh DB), coverage 98.3%; web 75 tests, 99.3%; fresh clone green;
compose smoke green on a fresh build and on a re-run.

## 8. In flight: finish PR #16 (Phase 10), then merge

Branch `feat/LOC-15-live-updates`, draft PR #16. Code, tests, docs and the
routine are done. **One self-review finding is open, fix approved in
principle but not yet implemented:**

- **Problem:** every page mounts its own `LiveRefresh`, so each navigation
  opens a new `EventSource`. Next only notices a closed browser connection
  about **65 s** later, so the relayed upstream API stream lingers that long
  (measured with 15 streams). Clicking around piles up orphaned API streams,
  each with a 15 s heartbeat that does a session DB lookup. Propagating
  `ReadableStream.cancel` to an `AbortController` was tried and does **not**
  help (64 s); it was reverted.
- **Fix to implement:** mount `LiveRefresh` **once in
  `apps/web/src/app/(dashboard)/layout.tsx`** (layouts persist across
  App Router navigation) and remove it from the three pages. Derive the
  incident id from the URL with `usePathname()` (`/incidents/<id>` -> that id;
  anything else -> refresh on any event). Keep `lib/live.ts` `isRelevant` as
  is. Update `components.test.tsx` (navigation keeps one EventSource; the
  incident filter follows the pathname) and mutation-check it.
- **Re-measure** (expect the API connection count to stay at 1 per tab while
  navigating). Count API connections on :4000 inside the api container:
  `docker compose exec -T api sh -c "awk 'NR>1 && \$2 ~ /:0FA0\$/ && \$4==\"01\"' /proc/net/tcp /proc/net/tcp6 | wc -l"`
- Then: `fix(web): keep one live stream per tab across navigation`, re-run
  the routine, update the PR body's "Draft: self-review finding pending"
  section into "Self-review fix", `gh pr ready 16`, Jira: LOC-63 and LOC-64
  Done, LOC-15 In Testing with a comment (deviation: no Redis pub/sub,
  option A agreed). The owner merges; then LOC-15 Done.

## 9. What is left, in order

The agreed order after Phase 9 is 12 (done), 10 (in flight), **11, 13, 14,
15**. Each needs the plan-first loop above; read the phase in `PLAN.md` and
the matching `.claude/skills/*` recipe first.

1. **Phase 11: real LLM provider, opt-in (LOC-16; subtasks LOC-65, LOC-66).**
   A provider behind the existing `LlmProvider` interface
   (`apps/api/src/investigations/provider.ts`); `LLM_PROVIDER` currently
   accepts only `fixture` (`config/env.ts`) and gains the real one plus
   `LLM_API_KEY`, `LLM_MODEL`. Structured output constrained by the same Zod
   schema; honour the `AbortSignal` (`callProvider` already races the
   timeout); bounded retry with backoff; `modelMetadata` stores model and token
   counts, never the key. Tests: a `*.live.test.ts` excluded from the default
   run and an opt-in CI job; CI must never call a network model by default.
   Default to the latest Claude models if Anthropic is chosen. This is also
   where a real-model prompt-injection check becomes possible (fixture tests
   only prove the plumbing).
2. **Phase 13: integration settings and secrets, adapter-gated (LOC-18;
   LOC-71..74).** Read `ARCHITECTURE.md §13` (Integration gate) and the
   `cloudlabs-adapter` skill. `secrets/crypto.ts` (AES-256-GCM, versioned key
   from `CREDENTIALS_KEY`), `ProviderAdapter` with simulator and a CloudLabs
   adapter that reports **no capabilities** (so `not_configured`, never
   `connected`), settings endpoints that never echo credentials, a settings
   page in simulator mode. **Do not invent CloudLabs endpoints, auth or
   webhook signing.** Sync/webhooks stay unbuilt.
3. **Phase 14: E2E tests and metrics (LOC-19; LOC-75, LOC-76).** Playwright
   journey in CI against compose (seeded scenario, fixture LLM), including the
   negative cases visible in the UI (permission incident stays separate, a
   blocked action shows its rule) and the click-through nobody has done yet in
   a real browser. OTel metrics from real runs only. Also a good place to add
   an alert/metric for long-running transactions (they delay live updates).
4. **Phase 15: dependency graph (optional) and delivery (LOC-20;
   LOC-77..79).** React Flow graph; deployment target and release pipeline
   (the `deploy` input exists in CI but nothing sets it); README walkthrough
   with real screenshots and real numbers. Fix the deployment-related known
   gaps here (trustProxy for the login limit; forwarding client IP from the
   web server).

## 10. Known gaps (recorded in INFRA / PLAN; do not rediscover them)

- Login rate limit is effectively global behind the BFF (fails safe).
- `trustProxy` is off; behind a load balancer it must name the real hops.
- A long-open transaction anywhere on the DB server delays all live updates.
- Self-approval is allowed (single operator, no roles yet).
- The sweep's status re-check under its row lock has no test (needs an
  interleaving no public path can force).
- The incident list has no AI "likely cause" column (would need an upward
  import or a call per row); the detail page shows it.
- Dev databases can hold incidents from before Phase 8 stuck in
  `investigating` with no proposal (local data only).
- Branch protection on `main` is off.

## 11. Commands cheat sheet

```bash
npm install                    # all workspaces
npm run db:up                  # postgres only
docker compose up -d redis     # redis too (host port 6380 locally, see section 6)
npm run db:generate            # Prisma client
npm run db:migrate             # apply migrations to the dev DB
npm run dev                    # api :4000, worker, web :3000 (host)
npm run prisma:migrate:dev -w @labops/api -- --name <change>   # new migration
npm run prisma:drift -w @labops/api                            # must exit 0
docker compose up --build -d   # full stack; sign in at http://localhost:3000
docker compose up -d migrate   # re-run migrations + operator seed
scripts/compose-smoke.sh       # against a running stack (needs the root .env loaded)
scripts/clean-db-check.sh      # integration twice on a throwaway DB
gh pr create --draft ... ; gh pr ready N ; gh pr checks N
```

## 12. Jira reference

Site `labops-copilot.atlassian.net`, project key `LOC`, epic LOC-4. Story for
Phase N = `LOC-(5+N)` (Phase 10 = LOC-15, 11 = LOC-16, 13 = LOC-18, 14 =
LOC-19, 15 = LOC-20). Transition ids: 11 To Do, 21 In Progress, 31 In
Testing, 41 Done. Subtasks are Done when their commit lands; the story moves
to In Testing with the PR and to Done after the owner merges.
