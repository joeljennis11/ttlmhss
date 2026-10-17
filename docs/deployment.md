# Deployment and operations (Phase 12C)

This guide takes TTLMHSS from the repository to a running school server, and covers updates, rollback, backup, restore and troubleshooting. Everything here was verified **locally** on Linux, with these components:

- the production build;
- `NODE_ENV=production`;
- the shipped nginx configuration, with a self-signed certificate;
- `pnpm readiness`;
- a browser pass.

**It has not been deployed to a live host by the developer.** Domain, DNS, certificate, server and backups are operator tasks (see the last section).

## 1. Supported topology

```
browser ──HTTPS──▶ nginx :443 ─┬─ /api/*  ──▶ ONE API process (node dist/server.js) on 127.0.0.1:3000 ──▶ database
            HTTP :80 → 301     └─ /*      ──▶ apps/web/dist (index.html for app routes)
```

- **One host, one API process** (D‑123). Sign‑in locks and rate‑limit counters are kept in that process's memory. Running two or more API processes (cluster mode, several containers behind a load balancer) is **not supported**: each would count separately, which weakens the limits. A restart clears the counters, which is harmless.
- **The API listens on 127.0.0.1 only** and trusts `X‑Forwarded‑For` from nginx (`TRUST_PROXY=true`). nginx *overwrites* that header with the real client address, so clients cannot forge it.
- **Database**
  - PostgreSQL is recommended for production.
  - A SQLite file on persistent disk is supported for a small single‑server school.
  - Either way, the database must not be reachable from the internet.
- **Web app:** static files served by nginx. nginx adds the security headers, including the ones a page cannot set itself (`frame-ancestors`, HSTS).

## 2. Requirements

| | Version | Install |
|---|---|---|
| Node.js | 22 LTS or newer (`node -v`) | from nodejs.org or the distribution's NodeSource packages |
| pnpm | 10 (`pnpm -v`) | `npm install -g pnpm@10` (or `corepack enable`) |
| nginx | 1.18+ (1.25+ uses `http2 on;`) | `apt install nginx` |
| PostgreSQL (recommended) | 14+ | `apt install postgresql` |
| A domain name and an HTTPS certificate | — | the school's DNS provider; e.g. Let's Encrypt (`certbot`) |

## 3. Production environment variables

Keep them in `/etc/ttlmhss/api.env`:
- owned by root;
- `chmod 600`;
- loaded by the systemd unit.

`deploy/api.env.example` is the template (placeholders only). The API **refuses to start** when production settings are unsafe, and lists every problem without printing any value.

| Variable | Required | Value |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `HOST` / `PORT` | yes | `127.0.0.1` / `3000` (must match `proxy_pass`) |
| `DATABASE_URL` | yes | `postgres://user:password@127.0.0.1:5432/ttlmhss`, or `sqlite:/srv/ttlmhss/apps/api/data/ttlmhss.sqlite`. In‑memory databases are refused |
| `SESSION_SECRET` | yes | ≥ 32 random characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Placeholders and repetitive values are refused |
| `CORS_ORIGINS` | yes | the exact site address, e.g. `https://school.example` (https, no path, no `*`) |
| `TRUST_PROXY` | yes (explicit) | `true` behind the nginx above (requires `HOST=127.0.0.1`); `false` if clients connect directly |
| `COOKIE_SECURE` | no | defaults to `true` in production; `false` is refused |
| `SESSION_IDLE_TIMEOUT_MINUTES` / `SESSION_ABSOLUTE_TIMEOUT_HOURS` | no | 120 / 12 |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | no | 60 sign‑in requests per minute per client address (D‑121) |
| `LOGIN_MAX_FAILED_ATTEMPTS` | no | 5 failures for one username from one address → that address is locked for the lockout time |
| `LOGIN_ACCOUNT_MAX_FAILED_ATTEMPTS` | no | 20 failures for one username from all addresses → only addresses the user has not recently signed in from are locked |
| `LOGIN_LOCKOUT_MINUTES` | no | 15 (locks always expire by themselves) |
| `LOG_LEVEL` | no | `info` |
| `SMS_PROVIDER` | no | `none` (the only value in this version, D‑125) |

The web app has **no** environment variables and no secrets. It calls the API on the same site (`/api`).

## 4. First installation

Run as an administrator on the server. Commands that change the database are marked ⚠.

```bash
# 1. Code (a release archive or git), owned by a dedicated user
sudo useradd --system --create-home --home-dir /srv/ttlmhss ttlmhss   # once
sudo -u ttlmhss git clone <repository-url> /srv/ttlmhss                # or extract the archive there
cd /srv/ttlmhss

# 2. Dependencies (exactly the locked versions)
sudo -u ttlmhss pnpm install --frozen-lockfile

# 3. Environment
sudo mkdir -p /etc/ttlmhss
sudo cp deploy/api.env.example /etc/ttlmhss/api.env
sudo chmod 600 /etc/ttlmhss/api.env
sudo nano /etc/ttlmhss/api.env        # fill in DATABASE_URL, SESSION_SECRET, CORS_ORIGINS

# 4. Build API + web
sudo -u ttlmhss pnpm build

# 5. ⚠ Create the schema (PostgreSQL: create the empty database and user first)
cd apps/api
sudo -u ttlmhss env $(sudo cat /etc/ttlmhss/api.env | xargs) pnpm db:migrate:prod

# 6. ⚠ The first administrator (prints a one-time temporary password — note it privately)
sudo -u ttlmhss env $(sudo cat /etc/ttlmhss/api.env | xargs) pnpm account:prod create-admin <username>

# 7. API service
sudo cp /srv/ttlmhss/deploy/systemd/ttlmhss-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ttlmhss-api
sudo systemctl status ttlmhss-api       # "active (running)"; journalctl -u ttlmhss-api for logs

# 8. nginx: edit the domain and certificate paths in deploy/nginx/ttlmhss.conf, then
sudo cp /srv/ttlmhss/deploy/nginx/ttlmhss.conf /etc/nginx/sites-enabled/ttlmhss.conf
sudo nginx -t && sudo systemctl reload nginx
```

The `env $(… | xargs)` form passes the environment file to a one‑off command; values containing spaces need quoting in the file. Alternatively, run the same commands in a root shell after `set -a; . /etc/ttlmhss/api.env; set +a`.

## 5. Checks after every deployment

```bash
cd /srv/ttlmhss/apps/api
sudo -u ttlmhss env $(sudo cat /etc/ttlmhss/api.env | xargs) pnpm readiness:prod https://school.example
```

This is read‑only and prints no secrets. It checks:

| Area | What is checked |
|---|---|
| Configuration | production mode, secret set, secure cookies and HSTS, exact https origins, proxy setting, database type |
| Database | it can be reached, and no migrations are pending |
| Through the site | `/api/v1/health` answers, and reveals nothing beyond status, database up/down and time |
| Headers | the API and the web app send their security headers |
| Routing | an app route such as `/attendance` returns the app; an unknown API route gives a plain 404 |
| HTTP | plain HTTP redirects to HTTPS |

It exits with code 1 if anything fails.

**Manual smoke test (2 minutes):**
1. Open `https://school.example`. The padlock appears, and the sign‑in page shows the school logo.
2. Sign in as the administrator with the temporary password. The app asks you to choose your own password; do so.
3. Open Students, Timetable and Reports. Download any PDF report if data exists.
4. Sign out.

## 6. Staff onboarding

1. *Teachers → Add teacher.* The account is created with the TEACHER role, which the browser cannot choose.
2. On the teacher's page, *Issue temporary password.* It is shown once, never stored in plain text and never logged. Give it to the teacher in person.
3. The teacher signs in, and is shown only *Choose your own password*. Every other API call is refused until the password is changed.

The same applies to student accounts (admission) and to administrators created with `account:prod create-admin`. A forgotten password is handled by issuing a new temporary password, which also ends the account's sessions.

**Phone OTP / SMS:** no SMS provider is integrated in this version (D‑125). The application never claims to send SMS. To add a provider later, a developer implements `apps/api/src/core/sms/sms-sender.ts`. The operator then needs:
- a provider account;
- sender‑ID registration (in India, DLT registration of the sender ID and message templates);
- server‑side credentials.

Until then, the temporary‑password process above is the onboarding method.

## 7. Updating to a new version

```bash
cd /srv/ttlmhss
# 0. ⚠ Back up first (section 9) and note the current version: git rev-parse HEAD
sudo -u ttlmhss git fetch && sudo -u ttlmhss git checkout <new-release>     # or extract the new archive
sudo -u ttlmhss pnpm install --frozen-lockfile
sudo -u ttlmhss pnpm build
cd apps/api
sudo -u ttlmhss env $(sudo cat /etc/ttlmhss/api.env | xargs) pnpm db:status          # see what is pending
sudo -u ttlmhss env $(sudo cat /etc/ttlmhss/api.env | xargs) pnpm db:migrate:prod    # ⚠ applies pending migrations
sudo systemctl restart ttlmhss-api
# then section 5 (readiness + smoke test)
```

Migrations only add tables, columns and constraints, and never delete school records. Read the phase notes (`docs/phases/`) of the release before migrating.

### Rolling back a failed update

1. **The application fails but no migration was applied:**
   - check out the previous version (`git checkout <previous-commit>`);
   - run `pnpm install --frozen-lockfile && pnpm build`;
   - run `systemctl restart ttlmhss-api`.
2. **A migration was applied and the new version must be abandoned:** prefer **restoring the backup taken in step 0** (section 9), then deploy the previous version as in 1.
   - `pnpm db:rollback` (development) reverts one migration at a time. Its `down` step drops what that migration added, so any data entered into new tables since the update is lost.
   - Do this only after a backup, and only if no restore is possible.
3. Run the section 5 checks again.

## 8. Rotating secrets

| Secret | How to rotate | Effect |
|---|---|---|
| `SESSION_SECRET` | Generate a new value, put it in `api.env`, run `systemctl restart ttlmhss-api` | Everyone is signed out once; passwords are unaffected |
| Database password | Change it in PostgreSQL (`ALTER USER … PASSWORD …`), update `DATABASE_URL`, restart | — |
| TLS certificate | Renewed by the certificate tool (`certbot renew`), then `systemctl reload nginx` | — |
| A staff password | Issue a temporary password from the teacher's page | That person's sessions end |

## 9. Backup and restore

What to back up:

| What | Where | Notes |
|---|---|---|
| The database | PostgreSQL database or the SQLite file | Everything the school entered |
| Configuration | `/etc/ttlmhss/api.env`, the nginx site file | Contains secrets: store **encrypted and separately** from the database backups, or simply keep a secure record of the values |
| Code | the release / git commit | Reproducible from the repository; note the commit with each backup |

There are no uploaded files: the logo is part of the code (`assets/brand`).

Logs are not needed for recovery. They never contain passwords, temporary passwords, session tokens or cookies.

**Backup commands (⚠ read‑only on the database, but they write a file):**

```bash
# PostgreSQL — consistent while the API runs
pg_dump --format=custom --file=/var/backups/ttlmhss/ttlmhss-$(date +%F-%H%M).dump "postgres://user@127.0.0.1:5432/ttlmhss"

# SQLite — consistent online copy (do not just copy the .sqlite file while the API runs)
sqlite3 /srv/ttlmhss/apps/api/data/ttlmhss.sqlite ".backup '/var/backups/ttlmhss/ttlmhss-$(date +%F-%H%M).sqlite'"
```

**Recommended schedule (configure it yourself, e.g. a cron job or systemd timer):**
- **Frequency:** daily after school hours, plus before every update.
- **Retention:** keep 14 daily, 8 weekly and 12 monthly backups.
- **Copies:** keep at least one copy **off the server**, encrypted.
- **Restore test:** once a month, test a restore as below.

**Restore — always test in a separate place first, never over the live database:**

```bash
# PostgreSQL: into a NEW database, then point a test API at it
createdb ttlmhss_restore_test
pg_restore --no-owner --dbname=ttlmhss_restore_test /var/backups/ttlmhss/ttlmhss-2026-10-17-1900.dump
# SQLite: copy to a new file
cp /var/backups/ttlmhss/ttlmhss-2026-10-17-1900.sqlite /tmp/restore-test.sqlite
```

Check the restored copy:
- run `DATABASE_URL=<restored> pnpm db:status`, which must show no pending migrations for the same code version;
- run a test API on another port (`PORT=3999`) and sign in.

To restore production for real:
1. Run `systemctl stop ttlmhss-api`.
2. Keep the current (bad) database aside:
   - PostgreSQL: rename it (`ALTER DATABASE ttlmhss RENAME TO ttlmhss_broken_<date>`), then `createdb ttlmhss` and run `pg_restore` into it;
   - SQLite: move the file aside and copy the backup into place.
3. Start the API and run section 5.

There is deliberately **no** web endpoint for backups or restores.

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| API exits at start with `Invalid configuration:` and a list | Each line names the variable and the reason; fix `/etc/ttlmhss/api.env` and restart. Values are never printed |
| `TRUST_PROXY: true requires HOST to be a loopback address` | Set `HOST=127.0.0.1` (nginx on the same host) or `TRUST_PROXY=false` |
| Sign‑in works on the server but the browser shows "Invalid username or password" for everyone | The site is not opened over https or under the exact `CORS_ORIGINS` address; secure cookies are refused on http |
| "Too many attempts. Please wait a few minutes" | Five wrong passwords for that username from that network, or a guessing attack from many addresses. Wait 15 minutes, or ask the administrator to issue a temporary password. Restarting the API also clears all locks |
| Everyone at school is throttled at once | More than 60 sign‑in requests per minute from the school's address: raise `LOGIN_RATE_LIMIT_PER_MINUTE`. Also check that `TRUST_PROXY=true` and nginx sends `X-Forwarded-For`; otherwise every request looks as if it comes from 127.0.0.1 |
| 502 Bad Gateway | The API is not running: `systemctl status ttlmhss-api`, `journalctl -u ttlmhss-api -n 100` |
| A page reload on `/attendance` gives 404 | nginx is missing `try_files $uri /index.html;` |
| `migrations — pending` in readiness | Run `pnpm db:migrate:prod` (after a backup) |
| Health shows `database: down` | Check the PostgreSQL service and `DATABASE_URL` |

## 11. What needs a person or an outside account

These cannot be done from the repository:
- **Domain and DNS records** for the school's address.
- **The HTTPS certificate** (e.g. Let's Encrypt via certbot), and its renewal.
- **A server or VPS** with Node.js, nginx and PostgreSQL. The developer has not chosen or set one up.
- **The database server and its password.**
- **`/etc/ttlmhss/api.env`** with real values: generate the session secret on the server.
- **Backups:**
  - scheduling;
  - off‑server copies and their encryption;
  - monthly restore tests.
- **The first administrator account and its first password change.**
- **School data** (Admin → School setup). Do **not** copy the development database (`apps/api/data/*.sqlite`) to production; it holds synthetic test data only.
- **An SMS provider and sender registration**, only if phone verification is developed later (D‑125).
