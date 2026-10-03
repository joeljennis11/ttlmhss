# Phase 7 — Period‑wise Attendance

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting explicit Phase 8 instruction.

## Objective
Real period‑wise attendance driven by the published timetable. A teacher opens their own lesson; the server fixes date, period, class, section, subject and teacher and loads the students placed in that class. Class teachers manage their whole class. Administrators can do everything, with an audited override after the cutoff. Students see only their own attendance. No exams, marks or reports.

## Starting state
Phase 6 committed (`ee45649`; 280 tests, 36 e2e). The workspace also held an **uncommitted Phase 7 implementation** written after that commit, in an earlier session whose record was lost. Before building on it, it was reviewed file by file against every section of the Phase 7 instruction, and all its checks were run (typecheck, lint, 309 tests). It was kept. The remaining work (browser‑suite fixes, a phone layout bug, documentation) was completed in this session.

## Architecture
```
Published timetable (version in force on that date)
  → Date + Period → Teacher + Subject + Class/Section      register  (attendance_sessions)
  → students placed in that section on that date            enrolments (Phase 5)
  → one record per student per period                       attendance_records (- P A L C)
```
- **Statuses:** `-` Not marked · `P` Present · `A` Absent · `L` Leave · `C` Permission / conditionally excused.
- **Percentage:** P ÷ (P + A) × 100. L, C and `-` are excluded from the denominator. With no P or A the result is "not measurable yet", never 0% or 100%. The rule is implemented once, in `@ttlmhss/shared` (`countAttendance`), and used by the API and every screen.
- **Subject‑teacher scope** comes from the teacher's actual published lesson for that date and period. It never comes from Teacher → Subject or from IDs in the request.
- **Class teachers** get every period of their own section(s) in that year.

## What was implemented
**Database** — migration `0008_attendance` (database‑design.md §5d):
- `attendance_sessions`: one register per year + date + period + section. It keeps a snapshot of the lesson (timetable entry and version, subject, teacher) and a revision number for optimistic locking.
- `attendance_records`: unique on (academic year, date, period, student) and on (session, student). Each record references the enrolment. A database rule checks the status value, and that Leave has a reason.
- All references are RESTRICT. Students with attendance cannot be deleted, and years with registers count as in use.
- `TimetableRepository.versionInForce` finds the version that was live on a date.

**Registers**
- *Opening a register:*
  - Resolved from the saved register, or from the timetable in force that day.
  - Refused for breaks, free periods, non‑working days, dates outside a year and lessons with no published timetable.
- *Saving:*
  - Only changed students are sent, and they are saved in one transaction (all or nothing).
  - Unmarked students stay `-`.
  - A save based on a stale revision is refused with "reload".
  - Future dates are viewable only.
- *Cutoff:* the Phase 4 policy applies. After the cutoff a register is read‑only for teachers and class teachers. Administrators must confirm an override and give a reason.
- *Leave / C:*
  - Subject teachers set P / A / – only. L / C set by the class teacher appear read‑only to them.
  - Class teachers and administrators set L / C per student. They can also apply them across several periods of one student's day.
  - Leave requires a reason (Medical / Personal / School Activity / Other); Other needs a description.

**Views** (also the reporting foundation for Phase 11):
- a teacher's lessons on a date, with each register's state;
- a class's day: period × student matrix, absentees, leave, unmarked periods and %;
- class totals over a date range;
- a student's own attendance: dates × periods, plus totals;
- an administrator register search with filters (date range, class, period, subject, teacher) and paging.

**Audit** — every changed record writes an `attendance.marked` or `attendance.override` audit entry. It records the actor, time, year, date, period, class/section, subject, teacher, student, old and new status, leave reason/note, whether it was an override or a multi‑period action, and the override reason.

**Web**
- Sidebar **Attendance** with: *My lessons* (teachers), *Class attendance* (class teachers and admins, with Day and Totals tabs plus a student‑day dialog), *All registers* (admin) and *My attendance* (students).
- *My timetable* gains **Today's lessons**. It shows *Take attendance*, or *Open attendance* once saved, only for the teacher's own published lessons.
- Register header: class, subject, teacher, full date, period and times.
- Status controls are real radio buttons, each with a letter and a text label, at least 44 px tall.
- *Mark all present* changes only unmarked students and reports how many it kept.
- Unsaved changes are marked, and leaving the page warns first. Saving shows a success toast and stays on the page.
- On phones each student is a card.

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (format, lint, typecheck, unit/integration/component) | clean — **309 tests in 21 files** (Phase 6: 280) |
| API `test/attendance.test.ts` (22, most on **SQLite and PostgreSQL**) | percentage rule (P P A = 66.67, P P L = 100, P C - = null, P A L C = 50) · context and roster from timetable + placements · create / update without duplicates, `-` preserved, audit before/after · database uniqueness, status and leave‑reason checks · no register for breaks, free periods, non‑working days, other years, the future · class teacher day, multi‑period L and C with reasons ("Other" needs a description), own class only · **security**: 401 signed out; 403 for another teacher's period, the same period in another class, another teacher, class views without class‑teacher role, admin search; extra `teacherId` / `subjectId` / `classId` in the body ignored; a student from another class refused; students see only their own attendance (unknown ids also 403) and never write · failed save stores nothing · stale revision refused · **cutoff**: editable until the configured day, then locked for teachers and class teachers; admin override needs a reason and is audited · **history**: a later timetable change does not rewrite past registers; each date uses the timetable in force then · roster follows placement dates, deactivated students excluded · student view · a storage failure part‑way rolls the whole save back |
| Web components `attendance.test.tsx` (7) | register from server, unmarked `-`, Mark all present keeps A/L/C, save sends only changes with revision, Leave reason validation, L/C read‑only for subject teachers, admin override dialog, conflict + reload, student totals |
| `pnpm --filter @ttlmhss/web test:e2e` | **41/41**. New: timetable → Take attendance → correct lesson → mark → save → reopen shows values; another teacher's period refused even by editing the address; class teacher class day + Leave across periods (subject teacher sees it read‑only); admin register search; student sees own attendance only; tablet/phone widths with no page overflow, 44 px targets and a readable name on read‑only rows. All Phase 1–6 flows pass. |
| `pnpm build` | builds (web JS 636 KB / 179 KB gzip) |
| Manual | screenshots at 1440/820/390 px of *My timetable* with Today's lessons, the register, class attendance, the student‑day dialog and *My attendance*, reviewed on the throwaway e2e database |

## Issues found and fixed during this phase
1. **Phone register layout:** on a read‑only row (e.g. Leave set by the class teacher), the status text took the narrow first column and squeezed the student's name to one letter per line. The status now spans the card. An e2e assertion was added, and it fails without the fix.
2. **Timetable drag‑and‑drop (Phase 6):** drop targets became active only after a React re‑render, so a fast drag could be ignored. The dragged lesson is now held in a ref and drop targets are always active while editing.
3. **Browser tests leaking state between files:**
   - The timetable spec reset the working days and removed a day the attendance spec uses, so publishing was correctly refused. It now keeps existing days.
   - The crest test now waits for the image to decode.
   - The drag test uses a tall window, because headless drag‑and‑drop cannot scroll mid‑drag.

## Known limitations
- **No admin override for non‑working days** (D‑53); add the day to the year's working days instead.
- **Holidays** inside working days are not modelled; a holiday shows as unmarked lessons.
- **Cancelling a whole lesson** for a class is not modelled. `C` is per student (D‑51).
- **No substitute teachers** (D‑24): a class teacher or administrator can take a register for an absent teacher's lesson.
- **Report views are computed per request** over at most 92 days. Phase 11 may add aggregates for long ranges.
- **Bundle size:** the web bundle is 636 KB; code splitting is planned for Phase 12.

## Decisions requiring input
- **D‑51:** confirm `C` = permission / conditionally excused, per student (the earlier docs said "Cancelled" for a whole period).
- **D‑52:** confirm subject teachers set only P / A / –.
- **D‑53:** confirm there is no attendance on non‑working days, even for administrators.
- **D‑06:** confirm L/C stay read‑only to subject teachers.

## Phase 8 dependencies
- None on attendance. Marks are subject‑wise (Exam → Subject → Class/Section), not period‑based. Marks should reference enrolments the same way attendance does.
