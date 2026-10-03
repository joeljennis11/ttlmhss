# Phase 5 — Student + Teacher Management

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting explicit Phase 6 instruction.

## Objective
Give administrators real management of students and teachers and the relationships later phases consume: admission with accounts, academic history, class changes, promotion, Teacher → Subject and class‑teacher assignments — without timetable, attendance, marks or portals.

## Starting state
Phase 4 committed (215 tests, 26 e2e). The Phase 1 tables `students`, `teachers`, `teacher_subjects`, `class_teacher_assignments` and `enrolments` existed with only basic columns and no endpoints or screens. Phase 2 had an account service (`AccountCredentialsService`) with temporary‑password support but no HTTP use.

## What was implemented
**Database** — migration `0006_people` (database-design.md §5b): student personal/guardian/contact/address fields, admission date, exit reason/date; teacher gender, date of birth, address, designation, qualification, joining date; enrolment note and who opened/closed it; case‑insensitive unique admission numbers and staff IDs; status and year indexes. Applied to the development database without data loss.

**Permissions** — new keys `students.transfer`, `students.deactivate`, `students.delete`, `teachers.deactivate`, `teachers.delete`, `teacher_subjects.view/manage`, `class_teacher_assignments.view/manage` in the existing catalogue; every management action is administrator‑only by ceiling (no non‑admin role can be given it), `students.promote` moved to administrator‑only (permissions.md §8–9).

**API** — `modules/people/` (architecture.md §13), 24 endpoints:
- *Students*: server‑side search (name/admission no.), filters (year, class, section, status incl. left school / not placed), sorting, paging; detail with current placement, full history and account status; admission (record + STUDENT account + first placement, one transaction); edit details (identifiers and placement excluded); deactivate/reactivate (account disabled, sessions ended); class change within a year (close + open); place an unplaced student; delete only records created by mistake and never used; issue a one‑time temporary password.
- *Promotion*: candidates for a source class/section (flags students already placed in the target year); transactional promotion with an individual outcome per student (Promoted, Not promoted, Transferred out, Left); leavers need no next year.
- *Teachers*: search/filter (subject, designation, status) with paging; create (record + TEACHER account); edit; deactivate (also ends their class‑teacher roles); delete unused records; Teacher → Subject assign/remove; issue temporary password.
- *Class teachers*: per‑year board of all active sections; assign; deliberate replace (old assignment ended, kept); end.

**Rules** — business-rules.md BR‑ST‑08…14 and BR‑TCH‑05…06 (identifiers, admission, placement history, class change, promotion, deactivation/deletion, temporary passwords, Teacher → Subject, class teacher).

**Web** — sidebar section **Management** (administrators): Students list, Admit student, Student profile (compact, "All details" dialog, history table, Change class, Place in class, Promote/record outcome, Issue temporary password, Deactivate/Reactivate, Delete when allowed), Edit student, Promote students (three steps: choose class → set outcomes → review and confirm), Teachers list, Add/Edit teacher, Teacher profile (subjects with add/remove, class‑teacher roles and history, account), Class teachers board. UI kit additions: `Pagination`, `Avatar`, required‑field marks.

## Key relationships (kept separate on purpose)
| Relationship | Stored in | Phase |
|---|---|---|
| Teacher → Subject | `teacher_subjects` (teacher, subject) | 5 |
| Class teacher | `class_teacher_assignments` (teacher, year, section) | 5 |
| Teacher → Subject → Class/Section → Day → Period | timetable assignment table | **6** |

## Accounts and credentials
- Creating a student/teacher creates the login through the Phase 2 account service in the same transaction; the role is fixed by the workflow (STUDENT / TEACHER) — no request field can choose a role (tested with `role: "ADMIN"`).
- The generated temporary password is hashed (Argon2id) and discarded. The administrator presses **Issue temporary password** to get a new one: returned once with `Cache-Control: no-store`, shown once with a copy button, replaced on the next issue, never stored, logged or audited in plain text. First sign‑in forces a password change (Phase 2).
- Account status follows the record: deactivate/leave → account disabled and sessions ended; reactivate → enabled.

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (format, lint, typecheck, unit/integration/component) | clean — **252 tests in 16 files** (Phase 4: 215) |
| API (`test/people-admin.test.ts`, 31 tests) | on **SQLite and PostgreSQL (PGlite)**: admission + account + placement, validation and duplicate identifiers (case‑insensitive), roll numbers, inactive section, closed year, nothing half‑created after failures; search/filters/sorting/paging and wildcard escaping; edit audited with before/after; temporary password (no-store, sign‑in forced change, never in audit); deactivation blocks sign‑in and ends sessions; class change history; promotion with four outcomes, history preserved, no double promotion, **rollback when the second student fails**; deletion rules; teacher create/validation/edit/filters; Teacher → Subject (duplicate, inactive, unknown, removal, no class/period columns); class teacher assign/duplicate/replace/end and scope reaching the teacher's next request, class‑teacher list scope; teacher deactivation; security: 401 on all routes signed out, 403 for teacher and student on all, management permissions not grantable |
| Web components (`people.test.tsx`) | no Management menu for teachers, server paging and filters, admission client + server errors, one‑time password display, promotion request body, subject assignment |
| `pnpm --filter @ttlmhss/web test:e2e` | **32/32** — 6 new Phase 5 flows: role denial (UI + API), admit → issue password → find → edit, deactivate blocks sign‑in / reactivate, class change + promotion with history, add teacher + subject + class teacher (incl. replace prompt), phone‑width overflow on all management pages |
| `pnpm build` | builds (web JS 557 KB / 160 KB gzip) |
| Manual | dev API restarted on the migrated dev database; administrator sign‑in (Phase 3), School setup reads (Phase 4) and the new list endpoints work; 37 screenshots at 1440/820/390 px on a throwaway database with labelled sample data reviewed; 0 px horizontal overflow |

## Issues found and fixed during this phase
1. Leaving outcomes required a next academic year → target year now needed only when a student continues.
2. PUT replaces all details; a test that omitted a field caught it — the UI always sends the whole form (documented).
3. Duplicate student/teacher name in profile card and page title → name only in the title.
4. Subject chips indented by default list styles; search placeholder clipped; bulk "next class" select too wide → fixed.
5. Date formatting threw on an unreadable value → shows the value instead.
6. Existing Phase 3/4 tests updated for the new menu section and the `/students` path now existing.

## Known limitations
- **Photos:** no upload yet (D‑23); profiles show initials.
- **Configurable profile fields** (R‑4.8/R‑5.2) not built (D‑41).
- **Class‑teacher screens** are not built: class teachers can use the scoped API (own students, edit details) but have no pages until their portal phase.
- Usernames, admission numbers and staff IDs cannot be changed after creation.
- Transfer within the school is limited to one academic year (D‑44); leaving dates are "today" (D‑43).
- The class‑teacher "Assign" list loads up to 100 active teachers.
- The web bundle passed 500 KB; route‑level code splitting can be added in Phase 12.

## Phase 6 dependencies
- Timetable assignments must reference `teachers`, `subjects`, `sections`, periods and a year, and must only allow a teacher–subject pair that exists in `teacher_subjects` (BR‑TT‑02). Removing a Teacher → Subject pair that a published timetable uses must then be blocked.
- Students in a class = ACTIVE `enrolments` of that section and year; attendance rows should reference `enrolments.id`.
- Class‑teacher scope is already derived per request from `class_teacher_assignments` in the current year.
- Deactivated teachers (account disabled, class roles ended) must not be offered for new timetable slots.
