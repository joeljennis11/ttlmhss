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

**Current phase status:** Phase 0 complete. Waiting for Phase 1 instruction.

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
- **Attendance is period‑wise**: Date + Class/Section + Period + Student. Statuses `-` Not Marked, `P` Present, `A` Absent, `L` Leave, `C` Cancelled.
- **Attendance % = P / (P + A).** L, C and `-` are excluded from numerator and denominator.
- Subject Teacher marks P/A only for their own assigned periods. Class Teacher can view the whole day, edit authorized periods, apply Leave (reason: Medical / Personal / School Activity / Other → description required) and mark Cancelled.
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
- **Logo:** the user will supply the official school logo. Use it as‑is. **Never generate, redraw, invent, or substitute a placeholder logo.** Until provided, show the school name in text only. Store the official file under a single, documented asset path once received.
- UI must be responsive (desktop + mobile), with consistent components, loading / empty / error states, confirmations for destructive actions, toast feedback, search, filters and pagination where useful.
- Student profile is **compact** (photo, name, admission/roll, class, section, year, basic contact, quick stats) with detail in a modal/drawer — not a giant tab‑heavy page.
- Requests and announcements stay **simple** — no chat system, no ticketing platform, no complex notification infrastructure.

## 7. PDFs & reports

Real generated documents only: A4, official logo, school name, academic year, student info, proper tables, `#003300` branding, readable print‑friendly typography, signatures and page numbers where applicable. No fake download buttons.

## 8. Documentation map

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
