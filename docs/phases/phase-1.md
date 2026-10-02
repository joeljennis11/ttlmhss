# Phase 1 — Project Foundation & Data Layer

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting explicit Phase 2 instruction.

## Starting state
Repository contained only Phase‑0 documentation (CLAUDE.md, README.md, docs/). No code. Matched what Phase 0 recorded.

## Conflicts identified before implementation
- Phase 0 proposed **Prisma or Drizzle**. Both tie the schema to one provider (Prisma's datasource; Drizzle's per‑dialect table builders), which conflicts with the requirement that the provider stay replaceable. **Kysely** was used instead and the change is recorded as D‑03 (needs confirmation).
- TypeScript 7 is current, but typescript‑eslint supports `<6.1` — pinned TS 6.0 (D‑28).
- The functional entity list includes `Role`, `Permission`, `Break`, `ExamWeightage`; representations follow the Phase‑0 model (database-design.md §6) rather than one table each.

## What was implemented
**Tooling:** pnpm workspace (`apps/api`, `apps/web`, `packages/shared`), strict TypeScript, ESLint (with architectural import boundaries), Prettier, Vitest projects, `.editorconfig`, `.nvmrc`, `.gitignore`.

**`packages/shared`:** API envelope contract and error codes; controlled values (user role, record status, academic‑year status, period kind, weekday, enrolment/promotion status, attendance status `- P A L C` with labels, leave reason, timetable status, mark‑sheet status, request type/status, behaviour rating 1–5); validation building blocks (required/optional text, ISO date, time of day, hex colour, pagination, issue formatting).

**`apps/api`:**
- Config: Zod‑validated environment with dev/test/production modes, `.env` precedence, production safety rules, credential‑safe errors.
- HTTP: Fastify app factory, helmet, CORS allow‑list, server‑generated request ids, `defineRoute` convention (access + Zod schemas + thin handler), feature‑module convention, standard success/error envelopes.
- Errors: typed `AppError` hierarchy and a single mapper; internal details never reach clients.
- Auth boundary: `Authenticator` / `AccessPolicy` interfaces and a global access hook, wired **fail‑closed** (no authentication exists; all non‑public routes return 401; undeclared routes refused).
- Data layer: `DataStore` / repository interfaces; Kysely implementation for SQLite and PostgreSQL selected by `DATABASE_URL`; unit‑of‑work transactions; driver‑error translation; migration manager.
- Schema: migration `0001_foundation` (school_settings, academic_years, classes, sections, subjects, periods, users, teachers, teacher_subjects, class_teacher_assignments, students, enrolments, audit_logs) and `0002_school_identity` (TTLMHSS identity row; logo NULL).
- Audit: append‑only repository + `AuditRecorder` with secret redaction (no events emitted yet).
- Logging: Pino with redaction; pretty in development, JSON in production.
- Endpoints (real, public, non‑sensitive): `GET /api/v1/health`, `GET /api/v1/school/branding`.
- CLI: `db:migrate`, `db:rollback`, `db:status` (+ compiled `db:migrate:prod`). Server refuses to start with pending migrations; graceful shutdown.

**`apps/web`:** React 19 + Vite 8; brand tokens derived from `#003300`; typed API client; `useApiQuery` (loading/error/success); one foundation status page showing the school identity read from the database and live API/database status. Dev proxy `/api` → API. No logo, no favicon, no login, shell, sidebar or dashboard.

## Verification performed (all actually run)
| Check | Result |
|---|---|
| `pnpm install` | OK (native SQLite driver built) |
| `pnpm format:check` | clean |
| `pnpm lint` | clean (1 real issue found and fixed — see below) |
| `pnpm typecheck` | clean (shared, api, web) |
| `pnpm test` | **87 tests, 6 files, all passing**; data‑layer suite runs on SQLite **and** PostgreSQL 18 (PGlite) |
| `pnpm build` | shared, api (tsc) and web (vite) build |
| `pnpm db:status` / `db:migrate` on a fresh dev database | both migrations applied; status correct |
| Dev API (`tsx`) | health 200 / branding / 404 envelope verified with curl |
| **Compiled API in production mode** | refuses to start with pending migrations (exit 1); compiled migration CLI applies schema; server serves health + branding; helmet headers present; CORS only for the configured origin; JSON logs; invalid production config rejected with a clear list |
| `pnpm dev` (API + web) | web index served; `/api` calls work through the Vite proxy; no errors in logs |

Not verified: a visual check of the rendered page in a real browser (no browser available in the build environment — the browser tool blocks localhost). Build output, served HTML and the page's API calls were verified instead.

## Issues encountered and fixed
1. Kysely 0.29 moved the migrator to `kysely/migration` — imports updated.
2. Vitest resolve‑condition override changed how `@fastify/helmet` loaded `helmet` (every request 500 under test only) — replaced with a narrow alias for `@ttlmhss/shared`.
3. `ON DELETE RESTRICT` violations use `SQLITE_CONSTRAINT_TRIGGER` (SQLite) and `23001` (PostgreSQL), not the generic FK codes — classifier extended; covered by tests.
4. React hooks lint: state reset inside an effect — `useApiQuery` now derives loading state from the request key.

## Deliberately NOT done
No authentication, login/logout, password hashing, sessions, RBAC enforcement, permissions data; no student/teacher CRUD; no timetable, attendance, exams, marks, results, behaviour, achievements, announcements, requests, dashboards, student portal, reports or PDFs; no application shell or navigation; no sample school data; no logo or placeholder logo. Feature tables are deferred to their phases (database-design.md §6).

## Decisions needing user confirmation
D‑03 (Kysely), D‑04 (database provider — still open), D‑08 (teacher may be class teacher of only one section?), D‑09 (streams/electives — needed before Phase 8), D‑21 (sections permanent vs per year), D‑27 (frontend UI libraries — Phase 3), plus the Phase‑2 items D‑15, D‑18, D‑22.
