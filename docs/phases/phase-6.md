# Phase 6 — Timetable Management

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting explicit Phase 7 instruction.

## Objective
Make the timetable the source of truth that connects **Teacher → Subject → Class/Section → Day + Period → Academic Year**, with a draft → publish workflow, server‑side conflict prevention, scoped editing and the class/teacher/student views that later phases (attendance first) derive from — without building attendance, marks or portals.

## Starting state
Phase 5 committed (`9a39fd0`; 252 tests, 32 e2e). Periods, breaks and working days were configurable per year (Phase 4); `teacher_subjects` and class‑teacher assignments existed (Phase 5). The catalogue already had `timetable.view` and `timetable.manage` but nothing used them. The cloud workspace had been reset, so the repository was restored from the user's `ttlmhss-phase5.tar.gz` (history intact) and verified (252/252) before work began.

## The key relationship
| | Stored in | Meaning |
|---|---|---|
| Teacher → Subject | `teacher_subjects` (Phase 5, **unchanged**) | what a teacher **can** teach |
| Teacher + Subject + Class/Section + Day + Period | `timetable_entries` in a `timetable_versions` row of one academic year (Phase 6) | where and when they **do** teach it — the only link between a teacher and a class |

Class, teacher and student timetables, and from Phase 7 the attendance context (Date + Period + Class/Section + Subject + Teacher), are all **derived from the published version**. Nothing is stored twice and no permanent teacher↔class relation exists.

## What was implemented
**Database** — migration `0007_timetable` (database-design.md §5c): `timetable_versions` (DRAFT/PUBLISHED/SUPERSEDED, version number, created/updated/published by and at, superseded at; at most one draft and one published version per year, enforced by partial unique indexes) and `timetable_entries` (version, year, day, period, section, subject, teacher, created/updated by; unique (version, section, day, period) and (version, teacher, day, period)). All references RESTRICT. Academic years with a timetable count as in use. Applied with `pnpm db:migrate` (adds tables only).

**Workflow** (BR‑TT‑07, 12–17)
- *Start a draft*: copies the live version's lessons into a new version (or starts empty); audited.
- *Change the draft*: a batch of create / update / move / remove, applied in order in **one transaction**; any refused change rejects the batch with the reason and its position. A `dryRun` runs every check and rolls back — the editor uses it so a change is validated by the server **before** it appears.
- *Save draft*: sends the held changes for real (audited per lesson plus a "draft saved" entry).
- *Publish*: re‑validates the whole draft; refuses an empty draft or any problem lesson (listed with class, day, period and reason); otherwise, in one transaction, marks the old live version SUPERSEDED and the draft PUBLISHED with publisher and time. A failure at any point leaves the previous live version untouched.
- *Discard draft*: deletes only the unpublished draft (audited with its lessons).
- The published version is never edited; closed years cannot change.

**Conflict prevention** (server, `timetable-rules.ts`, backed by DB unique indexes): A teacher double‑booking; B class/section collision; C teacher not assigned the subject; D unknown/inactive class or section; E unknown/inactive subject; F unknown/inactive teacher; plus period must belong to the year, be a teaching period (not a break) and be active, and the day must be a working day of the year. Moves and edits are checked against the destination; the original stays when refused.

**History protection** — a period used by any timetable cannot be deleted; a Teacher → Subject pair used by the draft or live timetable cannot be removed; a teacher with timetable history cannot be deleted (Phase 4/5 services now check these).

**Permissions** — `timetable.view` (existing), `timetable.manage` (existing; now "edit the draft of their own class", ceiling Class Teacher) and a new `timetable.publish` (publish/discard; ceiling NONE → administrators only). Class Teachers do **not** get editing by default (D‑17); when the administrator grants it, every operation is checked against their own section(s) on the server. Views are scoped (permissions.md §10).

**API** — `modules/timetable/` (architecture.md §14): 15 endpoints (editor, options, versions, start/apply/publish/discard draft; years, viewable sections, class, teacher, own, student, lessons‑on‑a‑date).

**Phase 7 readiness** — `GET /timetable/lessons?date=` returns each lesson of a teacher on a date with Date + Period (times) + Class/Section + Subject + Teacher + version id. `TimetableRepository` exposes the published entries per teacher/section/day. **No "Take Attendance" action is shown** — it arrives with attendance (no placeholder).

**Web** — sidebar **Timetable** for staff with a sub‑navigation: *My timetable* (teachers), *Class timetables*, *Edit timetable* (holders of `timetable.manage`).
- Desktop/tablet: days × the configured periods with their times; breaks shaded and narrow; empty periods "Free"; lesson cards show subject and teacher (or class in teacher views); "Today" marked in the current year. The grid scrolls inside its own box if it must; the page never scrolls sideways.
- Editing: tap/click a free period → lesson form (class/section → day → period → subject → teacher, teachers filtered by Teacher → Subject); tap a lesson → edit, move (change day/period) or remove (with confirmation). Native HTML5 drag‑and‑drop on desktop (no new dependency). Unsaved changes are marked; Save draft / Discard changes / Publish timetable (confirmation) / Discard draft; problems listed before and after a refused publish; version history with who/when.
- Phones: one day at a time with day tabs; every action through the same form.
- All states: loading, no academic year, no periods, no working days, no classes, no subjects/teachers, not published yet, no lessons for you, permission denied ("no access" + API 403), validation/conflict messages, network/server errors with retry, draft/published status, save and publish success.

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (format, lint, typecheck, unit/integration/component) | clean — **280 tests in 19 files** (Phase 5: 252) |
| API `test/timetable.test.ts` (12) | on **SQLite and PostgreSQL (PGlite)**: full workflow (draft, two saves with create/move/update/remove, nothing live before publish, publish, second version copies and supersedes v1 which keeps its lessons); class/teacher/student views and lessons‑on‑a‑date; audit entries with before/after (year, day, period, class, subject, teacher, actor); validation C, D, E, F, break, other‑year period, unknown period, non‑working day, malformed input (400); conflicts A and B, unrelated lessons succeed, edit/move into a clash refused with the original intact; batch all‑or‑nothing; dry run stores nothing; publish refuses empty and invalid drafts with per‑lesson details and leaves the live version unchanged; discard audited; closed year, period deletion and Teacher → Subject removal guarded. Permissions: 401 signed out; teacher 403 on every edit/publish route; class teacher 403 by default, own class only once granted (create/move/remove in another class → 403), never publish, `timetable.publish`/`timetable.manage` not grantable beyond ceilings; view scope for teacher, class teacher, student, admin. **Atomicity**: a simulated storage failure after the old version was superseded returns 500 and rolls everything back |
| Data layer (`data-layer.test.ts`, +2 on both providers) | one draft/one published per year, all statuses accepted, unknown status/day refused, teacher and class collisions refused by the database, periods in use cannot be deleted; migrations roll back and re‑apply through `0007` |
| Shared (`timetable.test.ts`, 3) | weekday of a date, operation and batch schemas |
| Web components (`timetable.test.tsx`, 9) | grid headers from configured periods incl. break, free cells, add flow (teacher list filtered by subject, dry run then save sends the same operations), refused change shows the server message and changes nothing, remove confirmation text, publish problems listed, read‑only live view + start draft, no access without permission, teacher week, not‑published and no‑periods states |
| `pnpm --filter @ttlmhss/web test:e2e` | **36/36** — 4 new: administrator draft → add → clash refused → drag‑and‑drop move → save → remove (confirm) → save → publish → class view; teacher sees own week, no edit tab, no access page, API 403; class teacher blocked by default, then limited to own class without Publish once granted (setting restored); tablet and phone widths with 0 px page overflow and the phone day list. Phase 1–5 flows all pass (nav expectations updated for the new menu entry) |
| `pnpm build` | builds (web JS 590 KB / 169 KB gzip) |
| Manual | `pnpm db:migrate` / `db:status` applied `0007` to the development database; screenshots of the editor at 1440/820/390 px, the lesson form and the class view reviewed on the throwaway e2e database |

## Issues found and fixed during this phase
1. The admin academic‑year list needs `config.manage`, so teachers could not open their timetable → added `GET /timetable/years` (`timetable.view`) and a timetable year selector.
2. The e2e "class view" step raced the sub‑navigation; the test now waits for the URL.
3. Copy in Teachers/Home pages still said the timetable was "a later phase" → updated.

## Known limitations
- One timetable version covers the whole school for a year (D‑45); there is no per‑class publishing and no future‑dated "effective from" (a version is effective from the moment it is published).
- Substitutions / one‑day changes are not supported (D‑24); a change means a new published version.
- A teacher can be deactivated while timetabled (D‑48): the lessons are flagged and block the next publish, but stay in the live version until it is republished.
- Teaching scope from the timetable is used only for timetable views; it does not yet open student lists to subject teachers (D‑49, Phase 7).
- No student timetable page (API only) until the student portal (D‑50).
- Class‑teacher scope is taken from the **current** year's assignments, also when editing another year's draft.
- Concurrent editors share the year's draft; a change based on a lesson someone else just removed is refused with "reload".
- The web bundle is 590 KB; route‑level code splitting remains planned for Phase 12.

## Decisions requiring input
- **D‑17** — confirm Class Teachers should be view‑only by default (the administrator can allow own‑class draft editing on the Permissions page).
- **D‑45, D‑47, D‑48** — confirm one school‑wide version per year, refusing empty drafts, and the deactivated‑teacher behaviour.
- **D‑49** — decide in Phase 7 whether subject teachers may see the students of classes they teach.

## Phase 7 dependencies
- The attendance context for a date is the PUBLISHED entry for that weekday (`/timetable/lessons`, `TimetableRepository.listEntries(version, { teacherId | sectionId, day })`). Attendance rows should snapshot teacher and subject (D‑05) and reference `enrolments.id` for students.
- "Take Attendance" belongs on the lesson cards of *My timetable* once the attendance route exists.
- Working days and periods are per year; holidays are not modelled yet.
