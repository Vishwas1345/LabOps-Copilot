# DEPLOYMENT.md: deploying LabOps Copilot

Everything needed to stand this up and every decision behind it. Two paths:
the **live** one, Render and Neon (§0, at https://labops.onrender.com), and a
self-hosted VM behind Caddy (§1 to §11), run end to end locally but never on a
real host. Written to be handed to someone who has not seen this conversation.

Read `docs/GAPS.md` first: it says what the system does not do, and two of those
things shape every decision here.

**If you are resuming this work:** §0 is the live deploy. For the VM path, §4a
is the host provisioning and is where people get stuck, §5 is the deploy itself,
§11 is what has and has not been verified, and §12 is what must happen before
the site is genuinely public.

---

## 0. The free path with no card: Render and Neon

Every free VM (Oracle, Google Cloud, AWS, Azure) needs a card to sign up, and
Hugging Face Docker Spaces need a paid plan. Without a card, this is the path:

| Piece | Where | Why |
|---|---|---|
| API, worker, web | One Render free web service, one container (`deploy/render/`) | Render has no free background worker, so the three run as separate processes in one container; the worker still never serves HTTP |
| Redis | Render Key Value, free, private network only | `noeviction`, because BullMQ must never lose a queued job. No per-command quota, unlike free hosted Redis that idle BullMQ polling exhausts |
| PostgreSQL | Neon, free | Permanent. Render's free Postgres is deleted after 30 days plus a 14-day grace period |
| HTTPS, hostname | Render, `<service>.onrender.com` | Included |

`render.yaml` describes it; `deploy/render/start.sh` boots it: reset the demo
database (below), migrate, seed the demo operator
(`SEED_OPERATOR_USERNAME=demo`), start the three processes, then ingest the
demo scenario through the real ingestion path (`dist/seed-demo.js`). The demo
routes stay off; nothing on the internet can trigger a scenario. The script
fixes `APP_ENV`, `SESSION_COOKIE_SECURE`, `DEMO_ENABLED`, `TRUST_PROXY_HOPS`,
`API_HOST` (127.0.0.1, so the API is unreachable from outside), `API_PORT` and
`API_INTERNAL_URL` after the platform's environment, so the dashboard cannot
contradict the production checks; `CORS_ORIGIN` falls back to Render's
`RENDER_EXTERNAL_URL`, and Next.js listens on Render's `PORT`. Render's health
check is `GET /login`. CI never builds `deploy/render/Dockerfile`; Render
builds it on every push to `main`.

**Verified live** (2026-10-16): the login page answers 200 over HTTPS and
reports `API: ok · PostgreSQL: up`, the five security headers are present, and
a warm page took about 0.27 s, measured from one client. The cold-boot and
memory figures below were measured locally under the same caps, not on the host.

**What this costs, plainly:**

- **It sleeps after 15 minutes without a request**, worker included. Locally,
  capped at 0.1 CPU, a boot took about 2.5 minutes to serve the login page
  (migrate, seed, then Next.js alone about 45 s). Warm it before showing it.
- **512 MB and 0.1 CPU** for three Node processes. Measured locally under the
  same caps: about 145 MB for the whole container, through a full incident
  journey. Each heap is capped anyway (`API_HEAP_MB`, `WORKER_HEAP_MB`,
  `WEB_HEAP_MB`).
- **Any process exiting stops the container**, so the platform restarts all
  three together rather than serving a site whose worker is dead.
- **750 free hours a month**, shared: exactly one always-on service fits.
- **Every boot starts from an empty database** (`DEMO_RESET_ON_BOOT=true` in
  `render.yaml`): `dist/reset-demo.js` drops the schema, then the boot migrates
  and seeds. A shared demo would otherwise stay resolved after its first
  visitor and age out of the dashboard's 7-day window. Anything a visitor did
  is gone after the service sleeps. The reset needs both `DEMO_RESET_ON_BOOT`
  and `APP_ENV=production`, and refuses, failing the boot, if any lab or event
  is not simulated; it drops the schema because the audit trail's triggers
  block deleting rows (`apps/api/src/modules/demo/reset.ts`).

**Standing it up:**

1. Neon: create a project in AWS Asia Pacific (Singapore), next to
   `render.yaml`'s `singapore`, the closest region to the expected audience
   (change both together if not; a Neon project cannot change region). Neon
   runs PostgreSQL 18; the integration suite passes on 18.6 as well as 16. Copy the **direct**
   connection string, not the pooled one: `prisma migrate deploy` takes an
   advisory lock.
2. Render: **New, Blueprint**, pick this repository. Enter `DATABASE_URL` and
   `SEED_OPERATOR_PASSWORD` (12+ characters) when prompted.
3. Wait for the deploy, open `https://<service>.onrender.com`, sign in as
   `demo`.
4. Optional Google sign-in: add the four `GOOGLE_*` variables in the service's
   environment, with redirect `https://<service>.onrender.com/auth/google/callback`.

---

## 1. Where it runs, and why

**Live on Render and Neon (§0); a single VM behind Caddy is the documented
alternative.** The VM was the first choice, but every free VM needs a card. The
reasoning is recorded because it is the question most likely to be re-litigated
later.

| Option | Verdict | Why |
|---|---|---|
| **Render + Neon** | **Live (§0)** | No card. Free web services sleep after 15 minutes idle and the free Postgres expires, so it runs as one container with Neon for the database |
| Single VM | Documented, run end to end locally, never on a real host | One host, one compose file, the existing Dockerfiles unchanged, no cross-origin auth; free VMs need a card |
| Vercel / Netlify | **Rejected** | They can host the Next.js app and nothing else. See §2 |
| Fly.io | Rejected | No free allowance for new accounts since October 2024: a short trial, then billing |

Both paths are free tiers, because this is a prototype with no budget. See
§9 for the VM path's free-tier risks, and §0 for Render's.

---

## 2. Why the obvious answer does not work

The stack is six services: `postgres`, `redis`, `migrate`, `api`, `worker`, `web`,
plus the new `proxy`. Three of them cannot run on Vercel or Netlify, and it is
worth writing down so nobody retries it:

| Component | Why it needs a real host |
|---|---|
| `worker` (`node dist/worker.js`) | Consumes BullMQ queues forever. Neither platform has a long-running process primitive. **Without it there is no correlation, no AI investigation and no recovery** — the entire product is the worker |
| `/api/events/stream` | Holds `reply.raw` open and polls Postgres every second. Serverless functions have hard maximum durations, so the live dashboard would disconnect constantly |
| `migrate` | A one-shot container running `prisma migrate deploy`. Not a function |

Splitting the frontend onto Vercel and the backend elsewhere works, but it buys
two deploys, CORS, and cross-origin cookie handling for no benefit over one host.
If the UI ever needs Vercel's preview URLs, do it as a later change, not first.

---

## 3. Three things that had to change before this was safe

These are code changes, not configuration. They are in PR #38 and each has a
reason that only matters once a stranger can reach the site.

**Investigation rate limiting.** `POST /api/incidents/:id/investigate` queues a
model call. It is the only route that can spend money. Unbounded, one signed-in
operator exhausts a free-tier key and it starts returning 503. It is now limited
to 10 a minute, in Redis, **failing closed** so a Redis outage refuses rather
than allowing unlimited calls. The limit is shared by every operator: the API
sees only the web server's address (see the next paragraph). Reading results is deliberately *not*
metered: an operator paging back through findings must not be throttled for
having investigated something.

**`TRUST_PROXY_HOPS`.** Tells Fastify how many proxies to trust for the client
address. Fastify takes a trust *function* rather than a count, so the count is
translated to "trust everything except the last hop". Both deploys set it to
`1`, but it has nothing to act on today: the browser reaches only the web
server, which calls the API without forwarding the client address. So the
login and investigation limits are global on every host (`docs/GAPS.md` §2).
Making them per person means forwarding `X-Forwarded-For` from the web server.

**`APP_ENV=production` refusals.** The API now fails at startup on:

- `SESSION_COOKIE_SECURE` not true — a Secure cookie over plain http is **never
  sent**, so nobody could sign in at all
- `TRUST_PROXY_HOPS` unset — required so a deploy states its proxy hops
  explicitly
- `DEMO_ENABLED` true — demo routes must never ship

Cheaper to catch at startup than to discover during an incident.

---

## 4. Two bugs found while building this

**The production compose file was an overlay first, and it leaked the database.**
Compose *merges* sequences rather than replacing them, so `ports:` from the
development `docker-compose.yml` survived the merge on `postgres`, `redis` and
`web` — the database was published to the internet while the overlay's own
comments claimed it was private.

Caught by reading back the rendered configuration rather than trusting the
source. `docker-compose.prod.yml` is now **standalone**, and the port exposure is
verified:

```
postgres  published: none        api      published: none
redis     published: none        worker   published: none
migrate   published: none        web      published: none
                                   proxy    published: 80, 443
```

Re-verify after any change to either compose file:

```bash
SITE_DOMAIN=x POSTGRES_PASSWORD=x docker compose -f docker-compose.prod.yml config
```

**`.env.production` and `backups/` were not gitignored.** The database password,
the AES credentials key, the model API key and the Google client secret were all
one `git add` from being committed. Both are now ignored, with the intent stated
in the file so nobody removes the lines.

---

## 4a. Provisioning the host first

Do this before §5. It is the part most likely to cost an afternoon, and none of it
is guessable from the repository.

### Which shape to pick, and why memory decides it

**Do not pick an AMD micro shape.** The free tier offers 1 GB RAM machines, and
this stack runs seven containers on the host — Postgres, Redis, the API, the
worker, the Next.js server, Caddy, plus the image build itself. 1 GB will thrash
or get OOM-killed during `docker compose build`, which is the worst way to find
out.

Ask instead for an **Ampere A1 (ARM)** shape: the Always Free allowance there
totals 4 OCPUs and 24 GB across the account, which is comfortable. The images
are `node:22-alpine` on `linux/arm64`, so they build and run on ARM without
change.

**The catch is capacity.** Free-tier ARM shapes are frequently reported as
"out of host capacity" in busy regions. This is the single most common way this
deployment fails, and it fails immediately and visibly rather than subtly.
Persistence is not guaranteed; if a region is full, try another one or try again
later.

Verify a card is required for the account regardless: Oracle runs a small
temporary authorisation on signup.

### Two things that will block HTTP even after the VM exists

**Oracle's own firewall drops inbound traffic.** Oracle Linux images ship
iptables rules that reject everything inbound, including 80 and 443, and the
console SSH session does not fix it. Check and correct before blaming Caddy:

```bash
sudo iptables -L INPUT -n --line-numbers   # look for a REJECT ALL rule
sudo sed -i '/-A INPUT -j REJECT/d' /etc/iptables/rules.v4
sudo netfilter-persistent save
```

**The VCN security list is separate.** In the cloud console, the subnet's security
list needs ingress for TCP 80 and 443 from `0.0.0.0/0`. Port 22 should be
restricted to your own address rather than opened to the world.

### Getting the repository onto the host

The server needs the code, and a deploy key is cleaner than copying a password
around. On the host:

```bash
git clone https://github.com/Vishwas1345/LabOps-Copilot.git
cd LabOps-Copilot
```

For a private repository, create a read-only deploy key in the GitHub UI under
Settings → Deploy keys, and use `git clone git@github.com:...` with that key in
`~/.ssh/id_ed25519` and `github.com` in `~/.ssh/known_hosts`.

A first deploy also needs enough disk for the images and for `./backups/`.

---

## 5. Standing it up from nothing

On the host, with the repository cloned:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
$EDITOR .env.production        # SITE_DOMAIN, POSTGRES_PASSWORD, SEED_OPERATOR_PASSWORD
./scripts/deploy.sh
```

`deploy.sh` backs up (skipped on a first deploy, when no database is running),
builds, applies migrations and starts everything. It then checks the API's
`/health` from inside its own container and the proxy's route to the web app,
30 attempts each, and a failure names the part that failed. It fails loudly
rather than returning early.

To roll back:

```bash
git checkout <previous-sha> && ./scripts/deploy.sh
```

Migrations run **before** the new containers start. That is safe only because
every migration since the first deploy target existed is additive (one early
migration changed `Lab.status`'s type in place, before there was any host). A migration that drops or renames a column
needs the expand-contract sequence instead, and `deploy.sh` does not handle it.

---

## 6. What the proxy does, and the one setting that matters

`deploy/Caddyfile` is the only thing exposed to the internet.

- Issues and renews the TLS certificate automatically
- Routes everything, the live stream included, to `web`; the browser never
  talks to the API. The API's rate limits therefore see the web server's
  address and are shared by every operator (`docs/GAPS.md`)
- **`flush_interval -1` on `/api/events/stream`** — response buffering would hold
  live events back, and for a stream that sends one event at a time that means
  never
- Sets `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`
  and `Referrer-Policy`, and strips `Server`. The web app sends these itself
  plus `Content-Security-Policy: frame-ancestors 'none'` (`next.config.mjs`), so
  the Render deploy without Caddy has them too
- Logs requests only, never bodies: a body can carry an operator's password

---

## 7. Configuration reference

Set in `.env.production` on the host:

| Variable | Required | Notes |
|---|---|---|
| `SITE_DOMAIN` | yes | The hostname the certificate is for. No default on purpose — compose refuses to start without it |
| `POSTGRES_PASSWORD` | yes | `openssl rand -base64 32` |
| `SEED_OPERATOR_PASSWORD` | yes, unless Google sign-in is configured | 12+ characters; `migrate` seeds the operator with it. Without it nobody can sign in |
| `SEED_OPERATOR_USERNAME` | no | Defaults to `operator` |
| `POSTGRES_USER`, `POSTGRES_DB` | no | Both default to `labops`; `backup.sh` and `restore.sh` read them too |
| `CREDENTIALS_KEY` | no | Base64 of exactly 32 bytes, for integration credentials. Empty counts as unset. Without it, saving a credential fails by name instead of storing it in the clear |
| `GOOGLE_*` (4) | no | All four or none. The redirect must match the OAuth client exactly: `https://$SITE_DOMAIN/auth/google/callback` |
| `LLM_PROVIDER` / `LLM_API_KEY` | no | `fixture` is the default and is free and offline. `gemini` calls the real API. Rate limited either way |

Set by `docker-compose.prod.yml`, deliberately **not** overridable from
`.env.production`: `APP_ENV`, `TRUST_PROXY_HOPS`, `SESSION_COOKIE_SECURE`,
`DEMO_ENABLED`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, `API_INTERNAL_URL`.
A deploy must not be able to contradict its own production checks.

---

## 8. The hostname does not have to be purchased

Automatic TLS verifies control of a hostname over port 80, and browsers reject a
certificate issued for a bare IP address. That is the **only** reason one is
needed.

| Option | Cost | Trade-off |
|---|---|---|
| Purchased domain | ~8-15/year | The only option with no caveat |
| **IP-based resolver** — `203-0-113-5.nip.io`, same on `sslip.io` | Free | **Works with this Caddyfile unchanged**, because issuance uses the ordinary HTTP-01 challenge and needs only a hostname resolving to this machine. Shared by many sites, so a certificate can occasionally fail to issue; switching resolver usually fixes it |
| Permanent free subdomain (e.g. `yours.eu.org`) | Free | Yours forever, but approval is manual and takes days to weeks |
| Cloudflare tunnel | Free | No hostname at all, but the URL changes on every restart. Fine for a ten-minute demo, wrong for anything you link people to |

An Oracle Always Free instance gets a stable public IP for its life, so an
IP-based hostname stays valid. Destroying and recreating the instance changes the
IP, and therefore the hostname.

---

## 9. Free-tier risks, stated plainly

- **A card is required** for Oracle's verification. Free to use, not anonymous.
- **Capacity is often unavailable.** The free shape is popular; provisioning can
  need several attempts or a quieter region. This is the most common reason this
  plan fails, and it fails early and visibly.
- **Idle instances can be reclaimed.** Oracle may reclaim Always Free compute
  that has been mostly idle. This application is idle nearly all the time, which
  is exactly that profile. Expect the box to disappear at some point; the data
  goes with it. Every lab is simulated, so this costs demo history rather than
  anything real, which is the one mitigation that actually helps here.
- **Usage-based hosts avoid reclamation** but bill monthly.

---

## 10. Backups

`scripts/backup.sh` writes a plain `pg_dump` to `./backups/` before every deploy
and keeps the seven newest, so a long-lived host cannot fill its own disk.
`scripts/restore.sh <dump>` verifies one by replaying it with `psql` into a
**scratch** database and counting tables and audit rows — never into `labops`,
which would destroy live data. `KEEP=1` leaves the scratch database for
inspection. Both ran end to end locally (§11).

**Run a restore once before you need one. An untested backup is not a backup.**

There is no off-host copy. Losing the VM loses everything on it, including the
backups. Adding an off-host sync is the single highest-value next step.

---

## 11. What has and has not been verified

**Verified:** lint, typecheck, 693 API unit tests, 238 integration tests, 141 web
tests, coverage 98.4% (api) and 93.2% (web), `prisma:drift` clean,
`docker compose config` valid, port exposure audited, and the
`APP_ENV=production` guard mutation-checked.

**Run end to end locally (2026-10-16), with `SITE_DOMAIN=localhost`:** a first
`deploy.sh` on an empty host, a second with its backup, HTTPS through Caddy
(its internal certificate for `localhost`), the redirect from http, the
security headers, an operator sign-in, the live stream through the web relay,
and `restore.sh` on a real dump (and refusing one with no tables). That run
found six bugs, all fixed: the scripts were not executable; the first deploy
tried to back up a database that was not running; Caddy refused its own config
(`trusted_proxies` belongs under `servers`); an empty `CREDENTIALS_KEY` stopped
the API; `restore.sh` read a plain-SQL dump with `pg_restore`; and the stream
bypassed the web relay to reach the API.

**Not verified:** a real host, a public certificate from Let's Encrypt, and
public traffic. Treat the first real deploy as the test of those.

---

## 12. Before it is genuinely public

1. **Access control.** There is one shared operator password. "Known users only"
   is not true until Google sign-in with an exact-email allow-list is configured
   — that makes the operator set explicit rather than "whoever knows the
   password". See `AGENTS.md` §13a. **This is the real gate.**
2. **Off-host backup.**
3. **Uptime monitoring.** Nothing pings the site, and nothing alerts on an
   incident being created.
4. **Alerts on long open transactions.** The metric exists; nothing watches it.

The rest is in `docs/GAPS.md`.

---

## 13. If you are picking this up next

1. Read `AGENTS.md` and `CLAUDE.md`. `AGENTS.md` §13 is the current task list.
2. `docs/GAPS.md` before describing this project's capabilities to anyone.
3. The live deploy is Render (§0): it redeploys on every push to `main`.
   `./scripts/deploy.sh` is the VM path.
4. The open item is Google sign-in against a real OAuth client (`AGENTS.md`
   §13a): every test so far stubs Google.