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
(`modules/labs/simulator.ts`, driven by `POST /api/demo/scenarios/:name`, or on
the live deploy by `dist/seed-demo.js` at boot).
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
`.claude/skills/recovery-action` as the highest-risk surface in the repository. The alternative, a
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
- **The rate limits are global, not per person.** Sign-in (password and
  Google) allows 5 attempts a minute and investigations 10, keyed on the
  caller's address. Every call reaches the API from the web server, which
  forwards no client address, so every operator shares one budget on every
  host: one person's typos lock everyone out of sign-in for a minute. It fails
  safe, so this is a usability limit rather than a security one.
- **Google sign-in has never been run against Google.** Every test signs an ID
  token with a locally generated key and stubs the token endpoint. The flow has
  never completed against a real OAuth client.
- **Google sign-in's flow cookie is unsigned.** The web server binds `state`,
  the PKCE verifier and `nonce` to the browser in an httpOnly cookie scoped to
  `/auth/google`, and the callback compares `state` in constant time, so the
  browser flow is protected against login CSRF. The cookie is plain base64
  JSON, though, so an attacker able to set cookies on this site could pre-seed
  it. The API's own Google endpoints store nothing and trust the values they are
  sent; that matters only where the API is directly reachable (the dev compose
  on port 4000).
- **`TRUST_PROXY_HOPS` is required in production but has nothing to act on.**
  The deploy sets it to 1 to pass the startup check, but the API sits behind
  the web server, which sends no `X-Forwarded-For`, so the address it sees is
  always the web server's. Making the limits per person means forwarding the
  client address from the web server and trusting that hop.

## 3. Cost and abuse

- **Investigations are rate limited, at ten a minute shared by every operator**
  (§2). Redis-backed and failing closed, in the namespace `investigation-limit`. Reading results
  is deliberately unmetered, so paging back through findings is never punished
  for having investigated something. Sign-in keeps its own, stricter limit.
- **Event ingestion is still not rate limited.** `POST /api/events` accepts
  anything a signed-in operator sends, capped at 16 KB per body.
- **No alerting or notification of any kind.** No email, no chat integration, no
  webhook outbound. An incident created at 2am is visible only to whoever opens
  the dashboard. `/api/metrics` reports a long open transaction if someone looks.
- **No backups.** The live deploy has no backup step, by design: a boot after
  10 idle minutes wipes and reseeds its demo database, so there is nothing to
  keep.

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
  untrusted and bounded by strict schema validation. A failed investigation
  returns the incident to `open`; a blocked proposal, an escalation or exhausted
  retries move it to `manual_review`. That path
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

- **The live deploy is one free container.** `https://labops.onrender.com` runs
  the API, the worker and the web app as three processes in one Render free
  service, with Redis on Render Key Value and PostgreSQL on Neon. Any process
  exiting restarts all three; there is no second instance and no failover.
- **It sleeps after 15 minutes without a request**, worker included, except
  from 08:00 to midnight IST, when `keep-warm.yml` pings it. The first
  visit after a sleep waits for a cold boot (about 2.5 minutes, measured locally
  under the same 0.1 CPU cap, not on the host).
- **The demo resets when idle.** A boot after 10 idle minutes (every wake from
  sleep) drops and reseeds the demo database (`DEMO_RESET_ON_BOOT`), so
  anything a visitor did is gone after the service sleeps. A deploy during
  that idle stretch resets it too, under the container being replaced. Every
  visitor shares the one `demo` login.
- **The demo's AI is the fixture**, not a model (`LLM_PROVIDER=fixture`), so
  every investigation on the live site is identical by design.
- **Render deploys from `main` only after every CI check passes**, including a
  build and boot of `deploy/Dockerfile`. Merging is not gated: `main` has no
  branch protection, so a failing PR can still be merged; it just never goes
  live.
- **A production boot refuses unsafe configuration.** `APP_ENV=production`
  makes the API fail at startup if the session cookie is not Secure, if no proxy
  hop count is given, or if demo routes are enabled. A Secure cookie over plain
  http is never sent, so that combination means nobody can sign in at all.
- **Secrets live in the environment.** They are service variables in Render's
  dashboard, and Render generates `CREDENTIALS_KEY`. A secret in the environment
  is readable by anything that can read the process, and rotating
  `CREDENTIALS_KEY` means re-sealing every stored credential.
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
- **Every failed sign-in is audited** without ever storing the typed username
  or the raw input, because `AuditEntry` is append-only. (No webhook receiver
  exists.)
- **Dev databases can hold old incidents stuck in `investigating`.** Local data
  only, from before the policy phase existed.

---

## Where each gap is recorded elsewhere

| Gap | Also in |
|---|---|
| Integration gate closed | `ARCHITECTURE.md` §13 |
| Recovery is simulated | `ARCHITECTURE.md` §10 |
| Rate limits are global | `AGENTS.md` §10, `INFRA.md` |
| Redaction depth limit | `platform/observability/redact.ts` |
| Google sign-in untested against a real client | `AGENTS.md` §13a |
| No RBAC | `AGENTS.md` §10 |
| Deployment gaps | `docs/dev/QUALITY.md` "Before production" |