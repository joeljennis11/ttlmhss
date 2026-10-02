# Open Decisions — TTLMHSS

Single list of decisions the specification leaves open or that need user confirmation. **Do not resolve any "Open" item silently** — ask the user, then record the answer here with the date.

Status: `Open` · `Proposed` (recommendation given, awaiting confirmation) · `Adopted` (implemented under a phase instruction; can still be revisited) · `Decided` (explicitly confirmed by the user).

## Technical

| ID | Decision | Recommendation / current state | Status |
|---|---|---|---|
| D‑01 | Language & repo layout | TypeScript; pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`) | Adopted in Phase 1 (Phase 1 instruction: follow the Phase‑0 architecture) |
| D‑02 | Frontend / backend frameworks | React + Vite SPA; Node.js + Fastify API | Adopted in Phase 1 (same basis) |
| D‑03 | ORM / query layer | **Kysely** behind repository interfaces — changed from the Phase‑0 proposal (Prisma/Drizzle) because it keeps one schema and one data layer working on several providers (architecture.md §8) | **Adopted — please confirm** |
| D‑04 | **Database provider** | Still undecided. The data layer supports SQLite and PostgreSQL via `DATABASE_URL`, both tested. Development/test default is SQLite (zero setup) — this is a development convenience, **not** a production choice. Recommendation for production: PostgreSQL | **Open — user decision** |
| D‑18 | Session strategy | **Server‑side sessions** (HMAC‑hashed token in DB) in an HttpOnly, SameSite=Lax cookie; idle + absolute timeouts. Rationale: real logout, immediate deactivation/scope changes (architecture.md §10) | Adopted in Phase 2 |
| D‑19 | PDF generation approach | HTML/CSS → headless Chromium (Playwright); good Tamil script support | Proposed |
| D‑20 | Hosting / deployment target | Depends on school's IT setup (cloud VM, PaaS, on‑premise). Also affects D‑04 | Open |
| D‑22 | Student/teacher login identifier | Auth accepts any lowercase username (letters, digits, `. _ @ -`). Recommendation for Phase 5: students = admission number, teachers = staff code | Open |
| D‑23 | Photo/certificate file storage | Local disk behind an interface (swap to object storage later) | Proposed |
| D‑27 | Frontend UI libraries (Tailwind, Radix, React Router, TanStack Query from the Phase‑0 proposal) | Not installed yet — Phase 1 uses CSS tokens + CSS Modules for one page. Decide in Phase 3 when the shell is built | Open |
| D‑28 | TypeScript version | Pinned `~6.0.3` because typescript‑eslint does not yet support TS 7 | Adopted |

## Domain

| ID | Question | Proposed default | Status |
|---|---|---|---|
| D‑05 | How do mid‑year timetable changes relate to past attendance? | Versioned timetable with effective‑from date; attendance snapshots teacher/subject | Proposed |
| D‑06 | Can a Subject Teacher overwrite `L`/`C` set by the Class Teacher? | No — L/C are read‑only to subject teachers | Proposed |
| D‑07 | `0` represents both "scored zero" and "absent" — should absence be distinguishable in reports? | Keep `0` as the visible value; optionally store an internal absent flag so reports can count absentees. Needs user decision | Open |
| D‑08 | Class‑teacher cardinality | Schema enforces **one ACTIVE class teacher per section per year** (spec says "a class/section"). "A teacher holds at most one class" is **not** enforced yet — awaiting confirmation | Partly adopted |
| D‑09 | Higher‑secondary groups/streams & electives (XI–XII groups, optional languages) — not every student in a section takes every subject | Support per‑student subject enrolment for exams/marks where needed | **Open — important** |
| D‑10 | Rounding of percentages / normalized marks | Round half up to 2 dp for display; store raw | Open |
| D‑11 | What students see when a submitted sheet is unlocked for correction | Keep showing last submitted values until resubmitted | Proposed |
| D‑12 | Rank ties and who is ranked (e.g. students with an absent subject) | Competition ranking (1,2,2,4); all enrolled students ranked once all subjects are final | Open |
| D‑13 | Who records behaviour ratings | Class Teacher (+ Admin) | Proposed |
| D‑14 | Request routing | Class Teacher of the student's section; Admin sees all | Proposed |
| D‑15 | "Permissions" management: fixed role map or Admin‑editable toggles; Class Teacher audit visibility | **Code‑defined catalogue + per‑role grants** (no permission tables); Class Teacher has no `audit.view`. Admin‑editable toggles can be added later without changing feature code | Adopted in Phase 2 — please confirm |
| D‑16 | Class Teacher student‑management scope (edit which fields? promote?) | View all + edit non‑protected contact fields; promotion proposed by CT, confirmed by Admin | Open |
| D‑17 | Can Class Teacher edit the class timetable or only view? | View only; Admin edits (avoids cross‑class teacher conflicts) | Open |
| D‑21 | Are sections defined per academic year or permanently? | Schema: sections are permanent (with status); the per‑year link comes from enrolments and class‑teacher assignments. Revisit if sections must differ by year | Adopted provisionally |
| D‑29 | Period structure scope | Periods/breaks belong to an academic year, so next year's timings can change without rewriting history | Adopted |
| D‑24 | Substitute / ad‑hoc teacher for a period (teacher absent) — who takes attendance? | Not in spec. Proposal: Class Teacher or Admin can mark; substitution feature only if requested | Open |
| D‑25 | Do internal/practical components have their own pass marks? | Configurable per component | Open |
| D‑26 | Leave entered after a subject teacher already marked `A` | Class Teacher's L replaces A, audited | Proposed |

## Added in Phase 2

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑30 | Password policy | 8–128 chars, letter + digit, not common, not containing the username (BR‑AUTH‑05). Simple enough for students; raise for staff if wanted | Adopted — please confirm |
| D‑31 | Session lifetime | Idle 120 min, absolute 12 h (configurable by env) | Adopted — please confirm |
| D‑32 | Lockout policy | 5 failures → 15‑minute lock per username; 10 sign‑in requests/min per IP. A school network may put many users behind one IP — raise `LOGIN_RATE_LIMIT_PER_MINUTE` if that causes lockouts at the start of a period | Adopted — please confirm |
| D‑33 | Self‑service password reset (email/SMS) | Not provided: "Forgot password" = ask the school office, who issues a temporary password. Avoids needing email/SMS infrastructure | Adopted — please confirm |

## Raised when the logo arrived

| ID | Question | Notes | Status |
|---|---|---|---|
| D‑34 | Higher‑resolution / vector logo for print | Supplied file is a 556 × 556 JPEG with a white background: fine on screen, may look soft on A4 PDFs | Open — optional input |
| D‑35 | Logo green vs brand colour | The logo's green measures ≈ `#345729`, lighter than the specified brand colour `#003300`; it also uses gold ≈ `#F6CB17`. Spec keeps `#003300` as primary; gold could serve as a sparing accent. Confirm in Phase 3 | Open |

## Pending inputs from the user

- ~~Official school logo file~~ — **received 2026‑10‑03**, stored unmodified at `assets/brand/ttlmhss-logo-official.jpg` (not yet used by the app; Phase 3). Optional: a higher‑resolution or vector original for sharp A4 printing (D‑34).
- School address, contact details, and signatory names/titles for PDFs.
- Current class/section list, subject list and period timings (for Phase 4 configuration — entered as data, not code).
