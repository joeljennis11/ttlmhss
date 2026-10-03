# CLAUDE.md — TTLMHSS Project Constitution

> **Read this file in full before making any change.** It is the permanent, non‑negotiable source of truth for this project. Detailed specs live in `docs/`; if `docs/` and this file disagree, this file wins until the user resolves the conflict.

**Project:** TTLMHSS — Thiruthangal Lions Matriculation Higher Secondary School
**Product:** A modern, production‑quality, web‑based School Management System (not a desktop app ported to the web).

---

## 1. Phase control (HARD RULE)

Development happens in explicit, user‑unlocked phases:

| # | Phase |
|---|-------|
| 0 | Project initialization, master specification, architecture, development rules |
| 1 | Project foundation and database/data‑layer foundation |
| 2 | Authentication and RBAC |
| 3 | School branding, login and application shell |
| 4 | Admin and school configuration |
| 5 | Student and teacher management |
| 6 | Timetable |
| 7 | Period‑wise attendance |
| 8 | Exams, marks and results |
| 9 | Student portal, behaviour and achievements |
| 10 | Dashboards, announcements and student requests |
| 11 | Reports, PDFs and annual reports |
| 12 | Full integration, security, testing and final UI/UX polish |

- **Never** start the next phase without an explicit instruction from the user.
- Implement **only** the phase requested. "Finish this feature" is never permission to build unrelated or future features.
- Do not silently introduce major new requirements.
- Do not make irreversible architectural decisions the spec leaves open — ask. Open decisions are tracked in `docs/decisions.md`.

**Current phase status:** Phase 8A complete (academic / working‑day calendar). Waiting for the next instruction (Phase 8B not started).

## 2. Workflow for every phase

1. Read `CLAUDE.md`.
2. Read the relevant `docs/` files (and `docs/decisions.md`).
3. Inspect the current repository.
4. Understand what already exists; do not overwrite working functionality unnecessarily.
5. Implement only the requested phase.
6. Run appropriate tests/checks; fix real issues.
7. Record the phase in `docs/phases/phase-N.md` and update docs that changed.
8. Summarize what changed.
9. **STOP.**

## 3. Roles

Exactly four primary roles — no others, **no Parent account**:

- **ADMIN** — system‑wide management (subject to the permission architecture).
- **TEACHER** — teaches subjects. Relationship is **Teacher → Subject** (from the Admin‑maintained subject master). Class association comes from **timetable assignments**, never a permanent teacher↔class binding.
- **CLASS TEACHER** — a Teacher who *additionally* holds a Class Teacher assignment for a class/section in an academic year. Broader permissions **only within that scope**. (Modelled as a scoped assignment on a teacher, not a separate account.)
- **STUDENT** — one student = one account. Read‑only access to **their own** data only.

Accounts: Teacher and Student accounts are created automatically when Admin adds a teacher / admits a student. Temporary credentials + forced first‑login password change. No public registration. Never store plaintext passwords.

## 4. Critical business rules (summary — full text in `docs/business-rules.md`)

- **Timetable:** assignment = Teacher + Subject + Class + Section + Day + Period. *Enter once → reflects everywhere* (class, teacher, student timetables, attendance context). Teacher double‑booking and class period collisions are **blocked**. Workflow **DRAFT → SAVE → PUBLISH**; only published versions are live. A period's primary action is **Take Attendance**. Marks are **not** period‑based.
- **Attendance is period‑wise**: Date + Class/Section + Period + Student. Statuses `-` Not Marked, `P` Present, `A` Absent, `L` Leave, `C` Permission / conditionally excused (per student; Phase 7, D‑51).
- **Attendance % = P / (P + A).** L, C and `-` are excluded from numerator and denominator.
- Subject Teacher marks P/A only for their own assigned periods. Class Teacher can view the whole day, edit authorized periods, and apply Leave (reason: Medical / Personal / School Activity / Other → description required) or C across several periods of a student's day.
- **Attendance locking** is configurable (e.g. September editable until 7 October). Admin can override; every override is audited.
- **Attendance audit:** user, timestamp, student, date, period, old status, new status, reason.
- **Marks are subject‑wise**: Exam → Subject → Class/Section. `0` = actual zero/absent; `-` = not entered. **Do not use "AB"** as the primary absent representation. Save Draft → Submit; submission **locks**. Admin / authorized Class Teacher can unlock; corrections audited.
- **Subject‑wise result visibility:** a subject's result becomes visible to the student as soon as that subject is submitted. Never wait for all subjects. A full report card only after the required results are finalized/published.
- Exams, grade ranges, normalization (e.g. 42/50 → 84/100, original retained), exam weightage and rank scope are **configurable — never hard‑coded, never assume equal weightage**.
- **Behaviour** is exam/result‑based (not daily), 1–5 ratings with Admin‑configurable categories and labels, optional remark.
- **Achievements** are managed by **Admin and Class Teacher only** — never Subject Teachers.
- **Student isolation:** a student can never access another student's data. Enforced in the backend.
- **History is preserved:** promotion, transfer, academic‑year change and class/section changes never destroy historical records. Prefer deactivate/archive over delete when dependents exist.
- Classes, sections, periods, exams, grades and student profile fields are **Admin‑configurable** — never hard‑code the school's structure into business logic.

## 5. Architecture principles (full text in `docs/architecture.md`)

- Clear separation: frontend · API · business logic (services) · authorization · authentication · data access (repositories) · PDF/report generation · configuration. No giant files.
- **Backend enforces all authorization.** Frontend permission checks are UX only.
- **Database provider is NOT decided.** Do not lock into SQLite / PostgreSQL / Supabase / Firebase / any provider without explicit user approval. Business logic depends on repository interfaces, never directly on a database client.
- **No mock functionality:** no fake buttons, fake success messages, fake downloads, fake DB operations or frontend‑only business logic. UI → API → Backend → Database must be real. A feature that isn't built yet is simply absent, not faked.
- Security is first‑class: password hashing, secure sessions, validation of every input, parameterized queries/ORM, env‑based secrets, rate limiting, audit logging.

## 6. Branding & UI rules

- **Primary brand colour: Dark Green `#003300` (RGB 0, 51, 0).** Use for sidebar, primary buttons, active navigation, headers, key accents, login branding, dashboard highlights, PDF branding. Derive lighter/darker shades for hover/selected/borders/highlights.
- Content on white/light neutral backgrounds. **Do not make the whole UI green.** Maintain accessible contrast (WCAG AA minimum).
- **Logo:** the user will supply the official school logo. Use it as‑is. **Never generate, redraw, invent, or substitute a placeholder logo.** The official logo was received on 2026‑10‑03 (`assets/brand/ttlmhss-logo-official.jpg`); an enhanced version supplied with Phase 4 (`assets/brand/ttlmhss-logo-enhanced.jpg`) is the master for web and PDFs (see `assets/brand/README.md`). Never edit either file; generate any needed sizes from the master by resizing only.
- UI must be responsive (desktop + mobile), with consistent components, loading / empty / error states, confirmations for destructive actions, toast feedback, search, filters and pagination where useful.
- Student profile is **compact** (photo, name, admission/roll, class, section, year, basic contact, quick stats) with detail in a modal/drawer — not a giant tab‑heavy page.
- Requests and announcements stay **simple** — no chat system, no ticketing platform, no complex notification infrastructure.

## 7. PDFs & reports

Real generated documents only: A4, official logo, school name, academic year, student info, proper tables, `#003300` branding, readable print‑friendly typography, signatures and page numbers where applicable. No fake download buttons.

## 8. Codebase conventions (established in Phase 1 — follow them)

- Monorepo: `apps/api` (Fastify), `apps/web` (React + Vite), `packages/shared` (contracts, controlled values, Zod building blocks). Commands: see README.md.
- **Routes** use `defineRoute` with a mandatory `access` declaration and Zod schemas; handlers call one service method. Feature code lives in `apps/api/src/modules/<feature>/` and is registered in `src/modules.ts` only when real.
- **Services** depend on repository interfaces (`src/data/data-store.ts`) — never on Kysely/SQL/drivers (ESLint enforces this). Only `src/data/kysely/**` touches the database.
- **Schema changes = new migration** in `src/data/kysely/migrations/` (portable DDL, working `down`, never edit an applied migration). Update `database-schema.ts` and `docs/database-design.md`.
- Throw typed `AppError`s; never leak internals. Use `AuditRecorder` inside the same `transaction` as the change it audits.
- Controlled values come from `@ttlmhss/shared`; never compare against bare strings.
- No sample/fake school data. Test fixtures are synthetic and live in throwaway databases.
- **Security (Phase 2):** every protected route uses `access: requires('<permission>')`; every service method re‑checks with `deps.authorization.authorize(principal, '<permission>')` and applies a scope check (`checkStudentScope`, `checkSectionScope`, …) before reading or writing records. Student‑facing data uses `principal.studentId`, never an id from the request. Permissions are granted only in `core/auth/role-permissions.ts`. Never return or log passwords, hashes or session tokens.
- **UI (Phase 3):** add pages to `apps/web/src/app/routes.tsx` (`SHELL_ROUTES`) with `permission`/`roles` and an optional `nav` entry — the menu is generated from it; never add menu entries for unbuilt modules. Use the tokens in `styles/tokens.css` and the components in `components/ui` and `components/layout`; school name and logo come from `useBranding()` / `<SchoolLogo>`, never hard-coded. Each page calls `usePageTitle()`. Frontend gating is UX only.
- **Configuration (Phase 4):** school structure and rules come from the Admin‑configured tables (`modules/config/`), read through repositories — never hard‑code them. Permission grants: code defaults in `core/auth/role-permissions.ts`, Admin overrides clipped to the ceilings in `@ttlmhss/shared` `PERMISSION_INFO`; never widen a ceiling to `ADMIN`‑only permissions. Admin pages are registered in `features/admin/admin-pages.ts`.
- **People (Phase 5):** a student's class/section/roll lives only in `enrolments` (one ACTIVE per year); never add a class column to `students` and never edit/delete past enrolments — close and open. Later attendance/marks/behaviour rows reference `enrolments.id`. Teacher → Subject (`teacher_subjects`), class‑teacher assignments and Phase 6 timetable assignments stay separate tables. Accounts are created only through `AccountCredentialsService` with a fixed role (STUDENT/TEACHER); temporary passwords are issued on demand and never stored or logged.
- **Timetable (Phase 6):** Teacher → Subject (`teacher_subjects`) is only what a teacher can teach; a timetable entry (Teacher + Subject + Class/Section + Day + Period in a `timetable_versions` row) is the only teacher↔class link. Every view and the future attendance context read the **PUBLISHED** version (`TimetableRepository`); never store a second class/teacher/student timetable. All rules live in `modules/timetable/timetable-rules.ts`; changes go through the year's single draft as an all‑or‑nothing batch; publishing is atomic and keeps the old version as SUPERSEDED history. Editing needs `timetable.manage` (Class Teachers: own section only, checked per operation); publishing needs `timetable.publish` (administrators only).
- **Attendance (Phase 7):** a register (`attendance_sessions`) is resolved by the server from date + period + section against the timetable version in force that day and keeps a snapshot of that lesson; never accept teacher/subject/class from the request. Records (`attendance_records`) reference `enrolments.id`, one per (year, date, period, student). Subject‑teacher scope = their own published lesson only; class‑teacher scope = their section in that year; L/C only for class teachers/admins. Every change is audited per record; saves are one transaction with a revision check; locked dates need `attendance.override` + a reason. Use `countAttendance` from `@ttlmhss/shared` for every percentage (P ÷ (P + A); null when none).
- **Academic calendar (Phase 8A):** whether a class/section works on a date comes ONLY from `CalendarResolver` (weekly pattern → the one date entry that applies → result); it is loaded with the timetable week frame (`frame.calendar`). Never read `academic_years.working_days` directly for a date decision. Calendar entries never overlap per section (validated in `CalendarService`); calendar changes never delete attendance — registers on later‑holiday dates stay read‑only history. Calendar management uses `config.manage`.
- Run `pnpm check` (lint + format + typecheck + tests) before finishing a phase; run `pnpm --filter @ttlmhss/web test:e2e` when UI flows change.

## 9. Documentation map

| File | Purpose |
|------|---------|
| `docs/requirements.md` | Complete functional & non‑functional requirements |
| `docs/business-rules.md` | Critical domain rules (authoritative detail) |
| `docs/permissions.md` | Conceptual RBAC + scope model |
| `docs/architecture.md` | Proposed architecture, stack and boundaries |
| `docs/database-design.md` | High‑level conceptual data model (provider‑agnostic) |
| `docs/decisions.md` | Open decisions and their status — check before deciding anything |
| `docs/phases/phase-N.md` | Record of what each phase did |

Keep docs accurate and lean. Update them when a phase changes something they describe. Do not create docs for their own sake.
