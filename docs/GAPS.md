# GAPS.md: what LabOps Copilot does not do

A blunt list of this project's limits, written so a reader is not misled by the
dashboard. Everything here is true as of the commit that added this file.

The project is a **prototype that demonstrates a workflow**, not a tool that
manages real lab infrastructure. Where the UI could imply otherwise, this file
is the correction.

---

## 1. The two that matter most

### 1.1 It connects to no lab operation platform. None.

LabOps Copilot does not integrate with any external lab operation platform. It
has never read a lab inventory from one, never received an event from one, and
never created, modified or deleted a lab on one.

Every lab it shows is one **its own simulator created**
(`modules/labs/simulator.ts`, driven by `POST /api/demo/scenarios/:name`).
There is no adapter with live capabilities. The integrations module has a
`ProviderAdapter` interface, but the lab platform adapter reports
`NO_CAPABILITIES`, makes no network call, and a test asserts it can never reach
a `connected` state.

**Why it is like this.** `ARCHITECTURE.md` §13 forbids inventing an integration:
endpoints, auth schemes and webhook signatures must come from a provider's real
documentation, and none has been verified. Writing a plausible-looking connector
would be worse than having none, because a reader could not tell the difference.

**Consequence.** The correlation, investigation and policy logic are exercised
only against data this project invented. If a real platform reports failures
differently, or names its resources differently, or emits events in a shape not
covered by `modules/events/schemas.ts`, none of that is tested. The workflow is
demonstrated; its generality is not.

### 1.2 Recovery does not recover anything.

Recovery is **simulated end to end**. When a proposal is approved and the
execute job runs, it does not contact any platform, restart any lab, reset any
credential or touch any infrastructure. It calls
`simulateRetry(category)` in `modules/labs/recovery-simulator.ts`, which returns
`ready` or `failed` **deterministically from the failure's error category**. The
same lab, failing for the same reason, always recovers the same way. There is
no I/O of any kind.

The UI presents this as recovering the lab, and a lab does move from `failed` to
`ready` with a verified incident resolution behind it. That state change is real
in this database and completely unreal outside it.

**This is not an oversight.** `canExecuteRecovery` is typed as the literal type
`false` in `ProviderAdapter`, so no adapter can enable live recovery without a
visible type change. That was a deliberate design decision, recorded in
`AGENTS.md` §4 as the highest-risk surface in the repository. The alternative, a
configurable recovery that could fire at real infrastructure, is the thing worth
being afraid of.

**What is genuinely real** in the recovery path: the seven-step policy
evaluation, the revalidation of policy against fresh state at execution time,
the approval audit trail, idempotency, and the verification gate that resolves
an incident only when every lab in it is ready. Those would survive a real
platform. The *action* would not.

---

## 2. Authentication and authorisation

- **One operator, no roles.** Every signed-in operator can do everything,
  including approving a recovery proposal they themselves proposed. There is no
  RBAC, no admin/operator split and no audit of who-did-what-beyond-identity.
  For a single-operator prototype this is fine; it is not fine the moment two
  people use it, and four-eyes approval would need roles before it could exist.
- **The login rate limit is effectively global.** It is 5 attempts per minute
  per client IP, and every dashboard sign-in arrives from the web server's IP
  because the browser talks only to the BFF. One person's typo lockouts
  everyone. It fails safe, so this is a usability limit rather than a security
  one.
- **Google sign-in has never been run against Google.** Every test signs an ID
  token with a locally generated key and stubs the token endpoint. The flow has
  never completed against a real OAuth client.
- **Google sign-in has no login-CSRF protection.** `authorization-url` accepts
  `state` and `nonce` from the request body and stores nothing, and the callback
  compares the token's nonce against that same client-supplied value. That
  proves only that the client repeated a value, not that this browser started
  the flow. PKCE still protects against an interposer, which is a different
  attack. A proper fix is server-side state in Redis.
- **`trustProxy` is set in production** (`TRUST_PROXY_HOPS=1`, matching the one
  Caddy hop), so the client IP behind the proxy is correct and the rate limits
  are per-client. It is unset locally, which is right: nothing proxies there.

## 3. Cost and abuse

- **Investigations are rate limited, at ten a minute per client.** Redis-backed
  and failing closed, in the namespace `investigation-limit`. Reading results
  is deliberately unmetered, so paging back through findings is never punished
  for having investigated something. Sign-in keeps its own, stricter limit.
- **Event ingestion is still not rate limited.** `POST /api/events` accepts
  anything a signed-in operator sends, capped at 16 KB per body.
- **No alerting or notification of any kind.** No email, no chat integration, no
  webhook outbound. An incident created at 2am is visible only to whoever opens
  the dashboard. `/api/metrics` reports a long open transaction if someone looks.
- **Backups exist but are only as good as the last verified one.** `scripts/backup.sh`
  dumps before every deploy and prunes to the seven newest; `scripts/restore.sh`
  proves a dump into a scratch database. There is no second copy off the host,
  so losing the VM loses everything in it.

## 4. Data handling

- **Secret redaction stops at six levels of nesting.** `redactSecrets` in
  `platform/observability/redact.ts` walks to `MAX_DEPTH = 6` and returns deeper
  values verbatim. A secret-named key nested seven or more levels deep in an
  event's `metadata` is stored in the clear.
- **Event metadata is unbounded in shape.** `metadata` is
  `record(string, unknown)`, so a provider may send arbitrarily nested and
  arbitrarily large structures. Only the 16 KB body cap bounds it, and
  `POST /api/events` uses the same cap.
- **One tenant, one schema, no isolation.** Every operator sees every lab,
  incident and audit entry. Multi-tenancy would require tenant keys on every
  model and a policy layer above the modules.

## 5. Observability

- **API request logs carry no trace id.** Worker and job logs do. One incident
  is one trace, but only from the worker inward.
- **The live stream is one database poller per API process.** It reads
  committed audit rows below `pg_snapshot_xmin` so delivery is gap-free, which
  is correct but means horizontal scaling multiplies polling against Postgres.
  A single long-open transaction anywhere on the database server delays live
  updates for everyone.
- **Nothing alerts on a long-running transaction.** It appears in
  `/api/metrics` and nowhere else.
- **Metrics derive from committed rows**, so they are only as current as the
  last commit. There are no performance budgets or latency SLOs anywhere in the
  project, and no load testing of any kind.

## 6. Model behaviour

- **The fixture provider is the default** and `gemini` is opt-in, so no deploy
  can start calling a paid API by accident. The cost is that the default
  investigation output is written by hand, not by a model.
- **The real provider is unreliable.** On a free-tier key, several model names
  returned 503 under load and one 429, repeatedly. A demonstration can be
  blocked by provider-side demand rather than by anything in this codebase.
- **A bad diagnosis is a supported outcome, not a bug.** Model output is
  untrusted and bounded by strict schema validation, and a failed or
  policy-blocked investigation moves the incident to `manual_review`. That path
  is correct and is covered, but it means the interesting outcome is not
  guaranteed on any given run.

## 7. Recovery and policy

- **Self-approval is permitted**, as noted above.
- **The expiry sweep's status re-check under its row lock has no test.** It needs
  an interleaving no public path can force, so that branch is unverified.
- **Four-eyes approval does not exist.** An operator can propose and approve the
  same action.
- **Recovery actions take no parameters.** The allow-list is closed and every
  action is a fixed operation with no inputs. That is intentional and safe, but
  it means it cannot express a real-world action that needs an argument, such as
  "reset only this host in this cluster".

## 8. Scope and deployment

- **Deployed to a single VM.** One host runs Postgres, Redis, the API, the
  worker, the web server and the reverse proxy. It is a single point of failure:
  a restart takes everything down, and losing the disk takes the audit trail
  with it. `docker-compose.prod.yml` caps each service's memory and logs, which
  limits how far one component can damage the others, but there is no second
  host and no failover.
- **No CI deploy path.** Deploying is `git pull && ./scripts/deploy.sh` over
  SSH by hand. There is no image registry, no image publishing and no automated
  rollout, which is deliberate: a registry would add a credential surface for
  something that is ultimately a six-service restart.
- **A production boot refuses unsafe configuration.** `APP_ENV=production`
  makes the API fail at startup if the session cookie is not Secure, if no proxy
  hop count is given, or if demo routes are enabled. A Secure cookie over plain
  http is never sent, so that combination means nobody can sign in at all.
- **Secrets live in one environment file on the host**, `.env.production`, mode
  600 and git-ignored. A secret in the environment is readable by anything that
  can read the process, and rotating `CREDENTIALS_KEY` means re-sealing every
  stored credential.
- **Branch protection on `main` is off.**
- **No incident list "likely cause" column.** The detail page shows the AI
  diagnosis; the list does not, because it would need an upward import or a
  model call per row.

## 9. What is deliberately *not* a gap

Some things that look like limitations are the design working as intended, and
should not be "fixed":

- **No live recovery.** Enforced by the literal `false` type (§1.2).
- **No speculative provider integration.** The gate is closed on purpose (§1.1).
- **The proposal-not-authority boundary.** The model proposes, deterministic
  code decides, a human approves. No path from model output to an executor skips
  schema validation, policy and approval.
- **Every rejected webhook and failed sign-in is audited** without ever storing
  the typed username or the raw input, because `AuditEntry` is append-only.
- **Dev databases can hold old incidents stuck in `investigating`.** Local data
  only, from before the policy phase existed.

---

## Where each gap is recorded elsewhere

| Gap | Also in |
|---|---|
| Integration gate closed | `ARCHITECTURE.md` §13 |
| Recovery is simulated | `ARCHITECTURE.md` §10 |
| Login rate limit is global | `AGENTS.md` §10, `INFRA.md` |
| Redaction depth limit | `AGENTS.md` §10 |
| Google sign-in untested, no login-CSRF | `AGENTS.md` §13a |
| No RBAC | `AGENTS.md` §10 |
| Deployment gaps | `README.md` "Before production" |