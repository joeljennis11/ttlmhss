# TTLMHSS

School Management System for **Thiruthangal Lions Matriculation Higher Secondary School**.

**Status:** Phase 11 complete — foundation, data layer, authentication, role-based access control, school branding, sign-in, the application shell and the Admin **School setup** area (school details, academic years, classes and sections, subjects, periods and breaks, attendance locking, grade scales, exams and exam subjects, behaviour and achievement categories, role permissions). Phase 5 added **student and teacher management**: admission with accounts, academic history, class changes, promotion, teachers with Teacher → Subject, and class‑teacher assignments. Phase 6 added the **timetable**: per‑year draft → publish versions, server‑side conflict prevention, a drag‑and‑drop week grid (day list on phones) and class/teacher timetables derived from the published version. Phase 7 added **period‑wise attendance**: Take attendance from a teacher's own published lesson, class‑teacher class views with multi‑period Leave / C, a configurable cutoff with audited administrator override, the P ÷ (P + A) percentage, and students' own attendance. Phase 8A added the **academic calendar**: holidays and special working days for the whole school, class ranges, classes or sections, which decide where attendance and timetable lessons can happen. Phase 8B added **exams, marks and results**: an exam lifecycle (draft → open for marks → closed), explicit per‑subject‑and‑section mark‑entry authorisation, mark sheets with components, draft / submit (lock) / reason‑required unlock, normalisation and grades, subject‑wise visibility for students, complete results with total, percentage and class/section rank. Phase 9 added the **student portal** (own profile, timetable, attendance, marks & results, behaviour and achievements, read-only), **exam-based behaviour** (one sheet per exam and class: draft → submit, reason-required corrections) and **achievements** (administrators and class teachers; archive/restore). Phase 10 added **role dashboards** (administrator, teacher, class teacher, student — each an actionable home built only from the existing services), **announcements** (whole school, staff, a class or a section; draft → published → archived, optional expiry) and **structured student requests** (attendance issue, result clarification, profile correction; open → in review → resolved → closed, routed to the class teacher or the office, never changing a record by itself). Phase 11 added **reports**: server-generated A4 PDFs (exam report cards, mark sheets, student and class attendance, student performance, annual reports) with the official logo and configured school identity, a class attendance Excel export, and **official annual reports** (configured exam weightage; draft → finalized with a frozen snapshot → published to the student). Phase 12A **hardened the application for production**: start‑up refuses unsafe configuration (weak secret, insecure cookies, wildcard or non‑https origins), strict security headers and CSP, per‑account rate limits on credential issuance and reports, stricter id validation, and an automated RBAC/IDOR security test suite. Phase 12B **verified the modules as one system** (cross‑module integration tests on SQLite and PostgreSQL, a browser and accessibility sweep of every main page at desktop, tablet and phone widths) and fixed the defects it found. Phase 12C is not started.

## Requirements
- Node.js ≥ 22.12 (`.nvmrc`)
- pnpm 10 (`corepack enable` provides it)
- No database server needed for development: the default is a local SQLite file. PostgreSQL is also supported via `DATABASE_URL` (the production provider is not decided yet — see `docs/decisions.md` D‑04).

## Getting started
```bash
pnpm install
pnpm db:migrate                         # creates apps/api/data/ttlmhss.dev.sqlite and applies migrations
pnpm account create-admin office.admin  # prints a one-time temporary password
pnpm dev                                # API on http://127.0.0.1:3000, web on http://localhost:5173
```
Open http://localhost:5173, sign in with the temporary password and choose your own password.

Optional: put `SESSION_SECRET=<48+ random chars>` in `apps/api/.env.development.local` so you stay signed in across API restarts.

## Commands
| Command | Purpose |
|---|---|
| `pnpm dev` / `pnpm dev:api` / `pnpm dev:web` | development servers (watch mode) |
| `pnpm build` | build shared, API (`apps/api/dist`) and web (`apps/web/dist`) |
| `pnpm start` | run the built API (`NODE_ENV=production` + real environment variables) |
| `pnpm db:migrate` / `pnpm db:status` / `pnpm db:rollback` | schema migrations for the database in `DATABASE_URL` |
| `pnpm account <create-admin\|reset-password\|deactivate\|activate> <username>` | operator account administration (there is no public registration) |
| `pnpm --filter @ttlmhss/api db:migrate:prod` | migrations using the compiled build |
| `pnpm test` / `pnpm test:watch` | all tests (data-layer tests run on SQLite and PostgreSQL) |
| `pnpm lint` / `pnpm format` / `pnpm format:check` / `pnpm typecheck` | static checks |
| `pnpm check` | everything above in one go |
| `pnpm --filter @ttlmhss/web test:e2e` | browser end-to-end tests against the real API (first run `pnpm --filter @ttlmhss/web exec playwright install chromium`, or set `CHROMIUM_PATH`) |
| `pnpm --filter @ttlmhss/web brand:assets` | regenerate web logo/favicons from `assets/brand/ttlmhss-logo-enhanced.jpg` |

## Configuration
API settings come from environment variables — see `apps/api/.env.example`. Committed `.env.development` / `.env.test` hold non-secret defaults; put local overrides and any secrets in `apps/api/.env.development.local` (git-ignored). In production, use real environment variables only; `SESSION_SECRET` (random, ≥ 32 chars), https `CORS_ORIGINS` and HTTPS (secure cookies) are required — the API refuses to start otherwise and lists the problems (see `docs/architecture.md` §21).

## Documentation
- Project rules: [CLAUDE.md](CLAUDE.md) — read first.
- [Requirements](docs/requirements.md) · [Business rules](docs/business-rules.md) · [Permissions](docs/permissions.md)
- [Architecture](docs/architecture.md) · [Database design](docs/database-design.md) · [Open decisions](docs/decisions.md)
- Phase log: [docs/phases/](docs/phases/)
