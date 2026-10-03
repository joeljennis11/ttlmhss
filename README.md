# TTLMHSS

School Management System for **Thiruthangal Lions Matriculation Higher Secondary School**.

**Status:** Phase 4 complete — foundation, data layer, authentication, role-based access control, school branding, sign-in, the application shell and the Admin **School setup** area (school details, academic years, classes and sections, subjects, periods and breaks, attendance locking, grade scales, exams and exam subjects, behaviour and achievement categories, role permissions). Student/teacher management and later modules are not built yet.

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
API settings come from environment variables — see `apps/api/.env.example`. Committed `.env.development` / `.env.test` hold non-secret defaults; put local overrides and any secrets in `apps/api/.env.development.local` (git-ignored). In production, use real environment variables only; `SESSION_SECRET` is required.

## Documentation
- Project rules: [CLAUDE.md](CLAUDE.md) — read first.
- [Requirements](docs/requirements.md) · [Business rules](docs/business-rules.md) · [Permissions](docs/permissions.md)
- [Architecture](docs/architecture.md) · [Database design](docs/database-design.md) · [Open decisions](docs/decisions.md)
- Phase log: [docs/phases/](docs/phases/)
