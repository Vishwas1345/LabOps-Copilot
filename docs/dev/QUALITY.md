# Testing, observability and delivery

How the project is tested, observed and built, and what is left before
production.

## Testing

Test layers mirror architectural boundaries, so a failure points at one:

| Layer | Scope |
|---|---|
| Unit (Vitest) | Normalisation, dedup, correlation scoring, transitions, policy decisions, AI output validation, UI helpers |
| Integration (Vitest, real Postgres + Redis) | Ingestion, queue and worker retries, correlation, investigation, approval races, execution and verification, audit, metrics, one-incident-one-trace |
| End to end (Playwright) | The operator journey in a real browser against the built compose stack: grouping, the investigation, a rejection, a double-clicked approval that runs once, live verification with no reload, the policy block, the dashboard and its filter |

Each SPEC acceptance criterion is mapped to the test that proves it in
[`docs/specs/labops-copilot/ACCEPTANCE.md`](../specs/labops-copilot/ACCEPTANCE.md).

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
| `changes.yml` | Runs on pushes and pull requests to `main`. Detects whether a change touched `apps/web` or `apps/api` (the root `package.json`, lockfile and ESLint config count for both; `docker-compose.yml` for the api), dispatches only the matching pipeline, runs the **deploy image smoke** job (`scripts/deploy-image-smoke.sh`) builds `deploy/Dockerfile` and boots it under 512 MB, twice, against a throwaway database when an app or `deploy/`/`render.yaml` changed, and runs the **compose smoke and e2e** job: build both images, boot the stack, run the smoke script, then reset the stack and run the Playwright journey |
| `api.yml` | Build, lint, unit tests, integration tests (real Postgres + Redis), coverage, schema drift, quality gate |
| `web.yml` | Build, lint, unit tests, coverage, quality gate |
| `llm-live.yml` | Opt-in, manual only: the one job that calls a real model |

The api and web pipelines each end in a quality gate that runs even when an upstream job
failed (`if: always()`): a secret scan, a dependency audit, and a check that
the scripts the pipeline depends on still exist.

Render deploys only after every check on the commit passes
(`autoDeployTrigger: checksPass` in `render.yaml`), so nothing that fails CI
goes live.

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
| 15 | Delivery: one incident as one trace, the opt-in trace viewer, this walkthrough |
| After 15 | Optional Google sign-in; the free live deploy on Render and Neon, reset on every boot ([`docs/infra/DEPLOYMENT.md`](../infra/DEPLOYMENT.md) §0); security headers from the web app |

---

## Before production

Known and deliberate. `docs/GAPS.md` is the full list; this is what is left
for a deployment meant to hold real work, beyond the live demo
([`docs/infra/INFRA.md`](../infra/INFRA.md) section 7).

- **Access control is one shared operator password** until Google sign-in with
  an exact-email allow-list is configured (`AGENTS.md` section 13a). That is the
  real gate on a public deployment.
- **One host is one point of failure.** The live deploy runs the API, the
  worker and the web app in one container (`docs/infra/DEPLOYMENT.md` §0), with
  no second instance and no failover.
- **The live demo keeps nothing.** It wipes and reseeds its database on every
  boot, so it is a demonstration, not a place to keep work.
- **Rate limits are shared.** Sign-in and investigation limits see the web
  server's address, not each operator's, because the web server forwards none.
- **No uptime monitoring and no alerting.** Nothing pings the site, and nothing
  tells an operator an incident was created while they were away.
- **Event ingestion is still not rate limited** (`POST /api/events`); sign-in and
  investigations are.
- **API request logs carry no trace id** until HTTP spans are added; worker logs
  do.
- **Nothing alerts on a long open transaction.** The metric exists; the alert
  does not.
- **No live lab platform connector.** Deliberate: nothing about a real provider's
  API has been verified, so none is invented (`ARCHITECTURE.md` section 13). The
  whole dataset is simulated and recovery repairs nothing.

---

## Non-goals

Deliberately out of scope for the MVP:

- Assuming access to any platform's private systems or undocumented endpoints
- Real recovery execution against a live platform, unless separately authorised
  and sandboxed
- Real cloud provisioning or destructive cloud operations
- Replacing a lab platform, or becoming a general-purpose lab creation platform
- Arbitrary command execution by an LLM
- Kubernetes or multi-service deployment
- Multiple cooperating AI agents without a clear need
- Production-scale claims from a local prototype

A live lab platform connector will only be implemented against verified official
documentation, supplied credentials and sandbox access. The provider-adapter
boundary exists so that adding it later does not change the pipeline. Until
then the simulator is the data source and the connection state reads
`not_configured`.
