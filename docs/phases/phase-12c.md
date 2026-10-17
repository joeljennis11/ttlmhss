# Phase 12C — Deployment readiness, operations and final workflow improvements

**Scope:** make the existing application ready to deploy and operate, and add timetable change requests. Phase 12 ends here. **No live deployment was made:** everything below was verified locally, using:

- the production build;
- `NODE_ENV=production`;
- the shipped nginx configuration, with a self‑signed certificate.

Starting point: `90d6136` (Phase 12B), clean tree.

## 1. Production configuration

Everything from Phase 12A is kept. New start‑up checks (D‑126, D‑125):

| Setting | Rule |
|---|---|
| `TRUST_PROXY` | Production must set it explicitly. `true` requires a loopback `HOST`, so only the local reverse proxy can supply `X‑Forwarded‑For` |
| `SMS_PROVIDER` | Only `none` is accepted; anything else stops start‑up with an explanation |
| `LOGIN_ACCOUNT_MAX_FAILED_ATTEMPTS` | New (default 20) |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | Default raised from 10 to 60 |

Other changes:
- **Caching:** every API response carries `Cache-Control: no-store` unless the route sets its own (D‑127).
- **Environment templates:**
  - `.env.example` updated;
  - `deploy/api.env.example` added (placeholders only);
  - variable reference in `docs/deployment.md` §3.

## 2. Web server and security headers

- `deploy/nginx/ttlmhss.conf` handles:
  - HTTP → HTTPS redirect (with an ACME challenge path);
  - TLS;
  - `/api/` proxied to 127.0.0.1:3000, overwriting `X‑Forwarded‑For` with the real client address;
  - static web app with `try_files $uri /index.html` for app routes;
  - 2 MB request limit;
  - 120 s read timeout for large reports;
  - gzip;
  - caching: `/assets/` immutable for a year, `/brand/` one day, the app shell `no-cache`.
- `deploy/nginx/security-headers.conf` sets, for the web app:
  - HSTS;
  - CSP = `WEB_CSP` + `frame-ancestors 'none'`;
  - X‑Frame‑Options DENY;
  - nosniff;
  - Referrer‑Policy no‑referrer;
  - Permissions‑Policy;
  - COOP.
- API responses keep the API's own headers. nginx adds none to `/api/`, so there are no duplicate or conflicting CSPs.
- `deploy/systemd/ttlmhss-api.service` runs ONE API process: dedicated user, `EnvironmentFile`, basic hardening.
- **CSP exceptions are unchanged from 12A:**
  - inline style attributes (React `style`);
  - `data:` and `blob:` images.

  No exception was added for this phase.

**Verified locally** with nginx 1.24, using the shipped files with only the domain, paths, ports and certificate substituted. The sandbox has no IPv6, so the `[::]` listen lines were dropped for the test.

| Check | Result |
|---|---|
| HTTP | 301 to HTTPS |
| `/attendance` | the app, with every header |
| `/api/v1/health` | the API's strict headers and `no-store` |
| Unknown API route | plain JSON 404 |
| Browser (no CSP bypass) | sign‑in, forced password change, admin/teacher/student navigation, class attendance **PDF and Excel downloads** (`%PDF`, `PK`) — 0 CSP violations, no console errors besides the expected 401 before sign‑in |
| Responsive / accessibility sweep through nginx | 180 page × width checks (1440 / 820 / 390): no horizontal overflow, no duplicate API calls; one contrast finding fixed (below) |

## 3. Sign‑in throttling (D‑121 → D‑124)

`LoginThrottle` now has two layers, plus the per‑address request limit:

| Layer | Limit | What it stops |
|---|---|---|
| Per client address (route limit) | 60 sign‑in requests per minute | Floods from one source. A class of 45 signing in from one school address passes (tested) |
| Per username + address | 5 failures → that address is locked for 15 minutes | Guessing from one place. The same teacher from another address is unaffected |
| Per username across addresses | 20 failures → addresses the user has **not** signed in from successfully in the last 30 days are locked for 15 minutes | Distributed guessing, without letting an attacker lock the teacher out at school |

- Unknown usernames are tracked identically, and the message is the same.
- Locks expire by themselves.
- Forwarded addresses count only when `TRUST_PROXY=true`.
- There is no IP allow‑list.
- Password change remains limited per account. Temporary‑password issuance stays at 20 per minute per administrator (12A).

## 4. Shared rate‑limit storage (D‑123)

The supported deployment is **one API process**. Counters stay in memory, and no Redis or other external store is introduced. Running several processes is documented as **unsupported** (`docs/deployment.md` §1); the limits would count per process and be weaker.

## 5. Dependency review (D‑117)

`pnpm audit`: one moderate advisory, `uuid` < 11.1.1 via `exceljs@4.4.0`.
- ExcelJS 4.4.0 is still the latest release, and pins `uuid@^8`.
- Its only use is `uuid.v4()` without a buffer, in conditional‑formatting ids. The vulnerable `v3/v5/v6(buf)` path is not reachable.
- No override was applied. Follow‑up: upgrade when ExcelJS releases.

This is a reachability assessment, not a claim that the dependency tree is free of vulnerabilities.

## 6. Staff onboarding (D‑125)

- **Unchanged and re‑verified through nginx in production mode:**
  1. The administrator adds a teacher; the role is fixed server‑side.
  2. A one‑time temporary password is issued (`no-store`, never stored or logged).
  3. The first sign‑in shows only *Choose your own password*. The dashboard API answered 403 until the change, 200 after.
- **Phone OTP is not implemented.** No SMS provider can be configured or tested here, and faking delivery is forbidden.
  - `SMS_PROVIDER=none` is validated at start‑up.
  - `core/sms/sms-sender.ts` is the interface a provider plugs into (`unavailableSmsSender` always refuses).
  - The operator steps a future integration would need are in `docs/deployment.md` §6.
  - Temporary passwords remain the onboarding method for every staff type. There are no new roles.

## 7. Timetable change requests (D‑122, BR‑TT‑19, migration 0014)

**Requests**
- A class teacher asks for a change to ONE slot of their own section: add, change subject/teacher, or remove, with a reason.
- The request records:
  - the academic year, section, day and period;
  - the existing lesson (a snapshot from the published timetable);
  - the proposal;
  - the requester and time;
  - the status;
  - the review (who, when, note);
  - a revision number.
- Only one request per slot may be pending (no duplicate notifications).
- At most 20 open requests per person, and 20 creations per minute.

**Review**
- Administrators (`timetable.publish`) **approve**. The change goes into the year's DRAFT through `TimetableEditorService.applyChanges`, which re‑checks section scope, qualification, and teacher and class clashes. A draft is started from the published timetable if there is none.
- Administrators **decline** with a reason. The requester may **withdraw**.
- A request whose slot no longer holds the lesson it was based on is refused as **stale** and stays pending. The same applies to a clash found at approval.
- Publishing is unchanged: administrator only, a separate step.
- **Permissions:** no new keys.
  - Class teachers ask within their own section (`timetable.view` + scope).
  - Direct draft editing still needs the administrator‑granted `timetable.manage` (D‑17).
  - Subject teachers and students get 403 everywhere.

**Notifications (in‑app only)**
- The administrator dashboard shows a *Timetable requests* panel: pending count, the newest five (class, day, period, requester, reason) and a *Review requests* link.
- The count is the same query as the review list.
- No email, SMS or push is sent or claimed.

**Audit**
- `timetable.change_requested`, `…_approved`, `…_declined`, `…_withdrawn` on entity `timetable_change_request`.
- The draft change is audited by the editor (`timetable.entry_*`, `timetable.draft_saved`).

**Web**
- `/timetable/requests`, a tab on the timetable pages for administrators and class teachers. It has a status filter, a request dialog (teachers filtered by the chosen subject), *Approve into draft* with confirmation, *Decline* with a reason, and *Withdraw*.

## 8. Requests and notifications reliability (Phase 10/12B)

- Historical‑class routing (D‑118) is preserved; `phase12b.test.ts` still passes on both databases. **D‑118 confirmed.**
- Duplicate student requests are limited by the existing open‑request limit. Resolution still never changes the record it is about (12B test).
- Dashboard notification links lead only to pages the role may open, and the server re‑checks.

## 9. Backup, restore, deployment

`docs/deployment.md` covers:
- topology;
- environment reference and how to generate the secret;
- first installation, using commands that exist (`pnpm install --frozen-lockfile`, `pnpm build`, `pnpm db:migrate:prod`, `pnpm account:prod create-admin`, systemd, nginx);
- readiness and the smoke test;
- staff onboarding;
- updates and rollback;
- secret rotation;
- backup with `pg_dump` / `sqlite3 .backup`, a recommended schedule and retention, and restore — test first, never over the live database;
- troubleshooting;
- the list of operator‑only tasks.

There is no backup or restore web endpoint.

**Readiness check:** `pnpm readiness [url]` (dev) / `pnpm --filter @ttlmhss/api readiness:prod [url]` (built). It is read‑only and prints no secrets. It checks:
- configuration;
- database connection and pending migrations;
- given the site URL:
  - health endpoint privacy (only status, database, time);
  - API and web security headers;
  - client‑side routing;
  - unknown API route → clean 404;
  - HTTP→HTTPS (standard ports).

All checks passed locally through nginx; the redirect check is skipped on the custom test port.

**Release archive (D‑128):** from this phase the archive contains no `*.sqlite*` files, so extracting it no longer overwrites a local development database.

## 10. Defects found and fixed

- The timetable editor's empty‑slot button text (`.freeButton`) failed contrast (`--ink-faint`); it now uses `--ink-muted`. This was seen only when a draft exists.

## 11. Files

- **New:**
  - `packages/shared/src/timetable-requests.ts`;
  - migration `0014_timetable_change_requests.ts`;
  - `modules/timetable/change-requests.repository.ts` and `change-request.service.ts`;
  - `data/kysely/repositories/timetable/change-requests.repository.ts`;
  - `core/ops/readiness.ts`, `scripts/readiness.ts`;
  - `core/sms/sms-sender.ts`;
  - `apps/web/src/features/timetable/pages/RequestsPage.tsx`;
  - `deploy/` (nginx, systemd, env template);
  - `docs/deployment.md`;
  - tests: `apps/api/test/phase12c.test.ts`, `apps/web/e2e/timetable-requests.spec.ts`.
- **Changed:**
  - `config.ts`, `login-throttle.ts`, `auth.service.ts`, `composition.ts`, `app.ts` (no‑store);
  - `rate-limits.ts`, `timetable.module.ts`, `dashboard.service.ts`;
  - shared `dashboard.ts`, `index.ts`;
  - data store registration, `database-schema.ts`, migration index;
  - web routes, `TimetableLayout.tsx`, `api.ts`, `DashboardPage.tsx`, `timetable.module.css`;
  - `package.json` scripts (`readiness`, `readiness:prod`);
  - tests updated for intentional rule changes:
    - `config.test.ts`: default 60, explicit `TRUST_PROXY`;
    - `phase12a.test.ts`: production fixture sets `TRUST_PROXY`;
    - `apps/web/test/phase10.test.tsx`: dashboard fixture.

## 12. Database

**Migration `0014_timetable_change_requests`** (one new table; nothing existing is altered).
- Tested on SQLite and PostgreSQL: up, rollback (`down` drops the table) and re‑apply.
- Applied to a copy of the e2e data set in production mode.
- **Operators and developers must run `pnpm db:migrate`** (development) or `pnpm db:migrate:prod` (production, after a backup).

## 13. Limitations

These are external or operator items, not done and not verifiable here:
- the domain and DNS;
- the HTTPS certificate;
- the server;
- PostgreSQL provisioning;
- real secrets;
- the backup schedule, off‑site copies and restore drills;
- the first administrator's password change;
- school data entry;
- an SMS provider and sender registration (only if OTP is built later).

Other limitations:
- Multi‑process deployment is unsupported (D‑123).
- The uuid/ExcelJS advisory is unresolved but unreachable (D‑117).
- Approving a change request applies the draft edit and then records the approval in a second transaction. If someone declines or withdraws the same request in that instant, the draft keeps the edit while the request shows the other outcome; a repeated approval is refused as stale. The draft is reviewed before publishing in any case.
- Live behaviour on the school's real network, certificate and proxy has **not** been verified.
