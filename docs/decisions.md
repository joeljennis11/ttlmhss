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
| D‑22 | Student/teacher login identifier | Default username = admission number / staff ID, lower‑cased, other characters → "-" (e.g. `2026/015` → `2026-015`); the administrator may type a different one at creation | Adopted in Phase 5 |
| D‑23 | Photo/certificate file storage | Still proposed (local disk behind an interface). Phase 5 shows initials; `students.photo_path` exists but no upload is built | Proposed |
| D‑27 | Frontend UI libraries | **Adopted in Phase 3:** React Router 8, CSS Modules + design tokens, lucide‑react icons, self‑hosted Public Sans / Source Serif 4. Not adopted: Tailwind, Radix, TanStack Query (unnecessary for the shell; revisit for data‑heavy modules) | Adopted — please confirm |
| D‑28 | TypeScript version | Pinned `~6.0.3` because typescript‑eslint does not yet support TS 7 | Adopted |

## Domain

| ID | Question | Proposed default | Status |
|---|---|---|---|
| D‑05 | How do mid‑year timetable changes relate to past attendance? | Versioned timetable; attendance snapshots teacher/subject. **Phase 6:** versions (effective from the publish moment). **Phase 7:** each register stores the timetable entry, version, subject and teacher; registers for a date use the version in force at the end of that school day | Adopted (Phase 7) |
| D‑06 | Can a Subject Teacher overwrite `L`/`C` set by the Class Teacher? | No — L/C are read‑only to subject teachers (implemented in Phase 7) | Adopted — please confirm |
| D‑07 | `0` represents both "scored zero" and "absent" — should absence be distinguishable in reports? | Keep `0` as the visible value; optionally store an internal absent flag so reports can count absentees. Needs user decision | Open |
| D‑08 | Class‑teacher cardinality | **One ACTIVE class teacher per section per year** (enforced; replacing is deliberate). A teacher may be class teacher of several sections (Phase 5 spec: do not assume one) | Adopted in Phase 5 |
| D‑09 | Higher‑secondary groups/streams & electives (XI–XII groups, optional languages) — not every student in a section takes every subject | Support per‑student subject enrolment for exams/marks where needed | **Open — important** |
| D‑10 | Rounding of percentages / normalized marks | Round half up to 2 dp for display; store raw | Open |
| D‑11 | What students see when a submitted sheet is unlocked for correction | Keep showing last submitted values until resubmitted | Proposed |
| D‑12 | Rank ties and who is ranked (e.g. students with an absent subject) | Competition ranking (1,2,2,4); all enrolled students ranked once all subjects are final | Open |
| D‑13 | Who records behaviour ratings | Class Teacher (+ Admin) | Proposed |
| D‑14 | Request routing | Class Teacher of the student's section; Admin sees all | Proposed |
| D‑15 | "Permissions" management: fixed role map or Admin‑editable toggles; Class Teacher audit visibility | Phase 2: code‑defined defaults. **Phase 4:** Admin can adjust Teacher / Class Teacher / Student grants within fixed per‑permission ceilings (no escalation; ADMIN fixed); stored as overrides. Class Teacher has no `audit.view` by default (grantable). User‑specific permissions not implemented (needs Phase 5 account management) | Adopted in Phase 4 — please confirm |
| D‑16 | Class Teacher student‑management scope (edit which fields? promote?) | Phase 5: Class Teachers may view and edit the details (not identifiers or placement) of students in their own section through the API; admission, class changes, promotion, deactivation and deletion are administrator‑only (ceilings). No CT screens yet | Adopted — please confirm |
| D‑17 | Can Class Teacher edit the class timetable or only view? | **Phase 6:** view by default. The administrator may grant `timetable.manage` to Class Teachers (Permissions page); they can then edit the **draft** of their own class only (enforced per change on the server). Publishing stays administrator‑only (`timetable.publish`, never grantable) | Adopted — please confirm the default |
| D‑21 | Are sections defined per academic year or permanently? | Schema: sections are permanent (with status); the per‑year link comes from enrolments and class‑teacher assignments. Revisit if sections must differ by year | Adopted provisionally |
| D‑29 | Period structure scope | Periods/breaks belong to an academic year, so next year's timings can change without rewriting history | Adopted |
| D‑24 | Substitute / ad‑hoc teacher for a period (teacher absent) — who takes attendance? | Not in spec. Proposal: Class Teacher or Admin can mark; substitution feature only if requested | Open |
| D‑25 | Do internal/practical components have their own pass marks? | Configurable per component | Open |
| D‑26 | Leave entered after a subject teacher already marked `A` | Class Teacher's L replaces A, audited (implemented in Phase 7) | Adopted |

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
| D‑34 | Higher‑resolution / vector logo for print | First file was 556 × 556. An enhanced 8000 × 8000 JPEG was supplied with Phase 4 and is now the master (D‑40). A vector original would still be ideal but is not needed | Resolved in Phase 4 |
| D‑35 | Logo green vs brand colour | The logo's green measures ≈ `#345729`, lighter than the specified brand colour `#003300`; it also uses gold ≈ `#F6CB17`. Phase 3 keeps `#003300` as primary everywhere and uses the crest gold **only** as the active‑page marker / focus colour on the green sidebar | Provisional — please confirm |

## Added in Phase 4

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑36 | Must active exam weightages total exactly 100%? | Total may never exceed 100%; the screen marks it "complete" at 100%. Phase 8 should require 100% before annual results (BR‑EX‑03) | Adopted — please confirm |
| D‑37 | Grade scale shape | Grades defined by minimum percentage only (contiguous by construction), two decimals; one scale per exam with optional per‑subject override | Adopted — please confirm |
| D‑38 | Attendance cutoff day range | 1–28 so it exists in every month; unconfigured = no locking until the Admin saves a rule | Adopted — please confirm |
| D‑39 | Pass marks per component (D‑25) | Phase 4 stores one pass mark against the total; per‑component pass marks can be added in Phase 8 if needed | Open (D‑25) |
| D‑40 | Web logo source | The enhanced 8000 px logo supplied with Phase 4 (`assets/brand/ttlmhss-logo-enhanced.jpg`) is now the master for web and PDF; the original is kept unchanged for reference | Adopted |

## Added in Phase 5

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑41 | Configurable student profile fields (R‑4.8 / R‑5.2) | Not built: fixed groups Personal, Parent/Guardian, Contact, Address, Academic. Adding definitions + values tables is possible later without changing the identity/history model | Open — confirm whether needed |
| D‑42 | How first passwords reach students/teachers | New accounts get a random temporary password that is hashed and never shown (nobody knows it); the administrator presses "Issue temporary password", sees it once and hands it over. No email/SMS | Adopted — please confirm |
| D‑43 | Promotion dates | Promoted/not promoted: source placement ends on the source year's last day, new one starts on the target year's first day. Leavers: today (or source year end) | Adopted — please confirm |
| D‑44 | Mid‑year transfer across academic years | Not allowed: class changes stay within one year; moving into another year is promotion | Adopted |

## Added in Phase 6

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑45 | One timetable per year vs per section | One version per **academic year** covering every class (one draft, one live). Publishing is school‑wide, which keeps teacher clashes across classes checkable in one place | Adopted — please confirm |
| D‑46 | What "Save draft" means | Edits are validated by the server as they are made (dry run) and held in the page; **Save draft** stores the batch atomically; **Publish** needs no unsaved changes. Leaving the page with unsaved changes warns first | Adopted |
| D‑47 | Empty or invalid drafts | Publishing an empty draft is refused (it would blank the live timetable); lessons made invalid by later configuration changes are listed and block publishing | Adopted — please confirm |
| D‑48 | Teacher deactivation while timetabled | Allowed (Phase 5 behaviour unchanged); the lessons are flagged in the draft and block the next publish until reassigned. The live timetable keeps showing them until republished | Adopted — please confirm |
| D‑49 | Teacher access to students of classes they teach | **Phase 7:** only per lesson — a subject teacher sees the roster of a register for their own published lesson on that date and period; no general student‑list access | Adopted |
| D‑50 | Students' timetable page | API foundation only (`/timetable/students/:id`, own placement); the page comes with the student portal (Phase 9) | Adopted |

## Added in Phase 7

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑51 | Meaning of `C` | Phase 7 instruction: **Permission / conditionally excused**, per student (earlier docs said "Cancelled" for a whole period). Shown as "Excused" with the full wording in help text. No reason list; optional note | Adopted — please confirm |
| D‑52 | Which statuses a subject teacher may set | `P`, `A` and `-` only; `L` and `C` belong to the class teacher / administrator (BR‑ATT‑05, CLAUDE.md) | Adopted — please confirm |
| D‑53 | Attendance on a configured non‑working day | Phase 7: refused for everyone, based on the year's weekly working days. **Superseded by D‑58 (Phase 8A):** the class‑aware academic calendar now decides; a special working day is added there instead of changing the weekly pattern | Superseded (Phase 8A) |
| D‑54 | Future dates | Registers can be viewed but not saved before the day | Adopted |
| D‑55 | Concurrent editing | Optimistic locking: each register has a revision; a save based on an older revision is refused with "reload". Multi‑period Leave/C saves always apply on top of the latest state | Adopted |
| D‑56 | Mark All Present | Sets only unmarked (`-`) students to `P`; P/A/L/C already chosen are kept (the UI says how many were kept). Nothing is saved until Save attendance | Adopted |
| D‑57 | Not‑marked lessons in student and class totals | Lessons that happened with no record count as `-` (shown, excluded from %) | Adopted |

## Added in Phase 8A

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑58 | Source of "is this a working day for this class?" | The academic calendar (weekly pattern + date entries per school / classes / sections), resolved only by `CalendarResolver`; replaces the year‑level check of D‑53 in attendance and timetable lessons. Still no attendance on a class's non‑working day, administrators included | Adopted |
| D‑59 | Overlapping entries | Refused (no precedence hierarchy): at most one entry per section per date | Adopted — please confirm |
| D‑60 | Class range | A UI convenience: resolved to explicit classes by display order when saved. Classes added to the school later are **not** added to existing entries | Adopted — please confirm |
| D‑61 | Timetable on special working weekdays | A section may hold lessons on a weekday only if it is a weekly working day or the weekday of a special working date for it; lessons still occur only on calendar‑working dates. If the same weekday later stops being special, those lessons are listed as problems at the next publish | Adopted — please confirm |
| D‑62 | Attendance on a date that later became a holiday | Kept, shown read‑only, and still counted (it was really recorded). Deleting the holiday makes it editable again | Adopted — please confirm |
| D‑63 | Calendar permissions | Reuses `config.manage` (School setup, administrators only); no new permission keys. Teachers/students consume the calendar only through attendance and timetable | Adopted |

## Pending inputs from the user

- ~~Official school logo file~~ — **received 2026‑10‑03** (`assets/brand/ttlmhss-logo-official.jpg`); an enhanced 8000 px version followed with Phase 4 (`ttlmhss-logo-enhanced.jpg`, now the master — D‑34 resolved for print size).
- School address, contact details, and signatory names/titles for PDFs.
- Current class/section list, subject list, period timings, exams, grade scale, motto and principal's name — the Phase 4 screens are ready; the school (or the developer with the school's data) enters them. Nothing has been pre‑filled.
