# DEPLOYMENT.md: deploying LabOps Copilot

Everything needed to stand this up on a server and every decision behind it.
Written to be handed to someone who has not seen this conversation.

Read `docs/GAPS.md` first: it says what the system does not do, and two of those
things shape every decision here.

---

## 1. Where it runs, and why

**One VM running the whole compose stack, behind Caddy.**

This was chosen among four options. The reasoning is recorded because it is the
question most likely to be re-litigated later.

| Option | Verdict | Why |
|---|---|---|
| **Single VM (chosen)** | Yes | One host, one compose file, the existing Dockerfiles unchanged, no cross-origin auth |
| Vercel / Netlify | **Rejected** | They can host the Next.js app and nothing else. See §2 |
| Render | Rejected | Free web services sleep after 15 minutes idle, which breaks the live stream, and the free Postgres tier expires |
| Fly.io | Viable second choice | Runs containers with a real worker, so it fits the architecture. Free allowance is smaller; pin a card to avoid surprise shutdowns |

The intended host is a cloud free tier, because this is a prototype with no
budget. See §9 for the free-tier risks, which are real.

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
to 10/minute per client, in Redis, **failing closed** so a Redis outage refuses
rather than allowing unlimited calls. Reading results is deliberately *not*
metered: an operator paging back through findings must not be throttled for
having investigated something.

**`TRUST_PROXY_HOPS`.** Behind a reverse proxy every request otherwise looks like
it came from the proxy. Two consequences: the rate limits stop being per-client,
and every logged IP is wrong. Set to `1` in the production stack, matching the
single Caddy hop. Fastify takes a trust *function* rather than a count, so the
count is translated to "trust everything except the last hop".

**`APP_ENV=production` refusals.** The API now fails at startup on:

- `SESSION_COOKIE_SECURE` not true — a Secure cookie over plain http is **never
  sent**, so nobody could sign in at all
- `TRUST_PROXY_HOPS` unset — the rate limits would key on the proxy's address
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

## 5. Standing it up from nothing

On the host, with the repository cloned:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
$EDITOR .env.production        # SITE_DOMAIN and POSTGRES_PASSWORD are required
./scripts/deploy.sh
```

`deploy.sh` backs up, builds, applies migrations, starts everything, then polls
`/health` for 30 attempts before reporting success. It fails loudly rather than
returning early.

To roll back:

```bash
git checkout <previous-sha> && ./scripts/deploy.sh
```

Migrations run **before** the new containers start. That is safe only because
every migration so far is additive. A migration that drops or renames a column
needs the expand-contract sequence instead, and `deploy.sh` does not handle it.

---

## 6. What the proxy does, and the one setting that matters

`deploy/Caddyfile` is the only thing exposed to the internet.

- Issues and renews the TLS certificate automatically
- Sets real client addresses, matching `TRUST_PROXY_HOPS=1`
- Routes everything to `web`; the browser never talks to the API
- **`flush_interval -1` on `/api/events/stream`** — response buffering would hold
  live events back, and for a stream that sends one event at a time that means
  never
- Sets `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`
- Logs requests only, never bodies: a body can carry an operator's password

---

## 7. Configuration reference

Set in `.env.production` on the host:

| Variable | Required | Notes |
|---|---|---|
| `SITE_DOMAIN` | yes | The hostname the certificate is for. No default on purpose — compose refuses to start without it |
| `POSTGRES_PASSWORD` | yes | `openssl rand -base64 32` |
| `CREDENTIALS_KEY` | no | Base64 of exactly 32 bytes, for integration credentials. Without it, saving a credential fails by name instead of storing it in the clear |
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
`scripts/restore.sh <dump>` verifies one by restoring into a **scratch** database
and counting rows — never into `labops`, which would destroy live data.

**Run a restore once before you need one. An untested backup is not a backup.**

There is no off-host copy. Losing the VM loses everything on it, including the
backups. Adding an off-host sync is the single highest-value next step.

---

## 11. What has and has not been verified

**Verified:** lint, typecheck, 684 API unit tests, 235 integration tests, 139 web
tests, 98.39% coverage, `prisma:drift` clean, `docker compose config` valid, port
exposure audited, and the `APP_ENV=production` guard mutation-checked.

**Not verified — this stack has never been stood up:**

- The compose file has never been started on a real host
- Caddy has never issued a certificate
- `deploy.sh`, `backup.sh` and `restore.sh` have never run end to end
- No HTTPS, no public traffic, no real login against it

Treat the first deploy as the real test of all of it.

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
3. Start the server: `./scripts/deploy.sh`.
4. The next piece of *feature* work is `AGENTS.md` §13b: a demo scenario where
   **two or more labs fail on one shared dependency**, which is the strongest
   correlation signal the schema names. Independent failures will not group
   convincingly. It needs no infrastructure and is unblocked.