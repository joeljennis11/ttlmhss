# Phase 9 — Student Portal, Behaviour & Achievements

**Date:** 2026‑10‑05
**Status:** Complete. Awaiting the next instruction (Phase 10 not started).

## Objective
- **Student portal:** a read-only view of the signed-in student's own academic information, built from the data of Phases 1–8B.
- **Behaviour:** the exam-based behaviour assessment deferred by Phase 8B (D‑78).
- **Achievements:** real student achievement records.

## Starting state
- Phase 8B was committed (`13f6ddf`) with 371 tests and 50 browser tests.
- Students already had a few pieces:
  - their own attendance (`/attendance/me`);
  - their results (`/results`);
  - a timetable API without a page (`/timetable/students/:id`, D‑50).
- Phase 4 provided behaviour categories, the five rating labels and achievement categories.
- The permission keys `behaviour.*` and `achievements.*` already existed.

## Student portal (BR‑PORTAL‑01…03)
**Navigation for students:** Home, My portal, My profile, Timetable, Attendance, Marks & results, Behaviour, Achievements, Change password (D‑89). Everything uses the existing shell and branding.

**Pages:**
- *My portal* — a greeting with year, class, roll and admission numbers, plus link tiles (not a dashboard).
- *My profile* (`GET /portal/profile`) — read-only identity, current placement, parents/guardian, contact and academic history. It contains no administrative metadata (no exit reason, deletability, audit or login data beyond username and status).
- *Timetable* — the PUBLISHED timetable of the student's own section (Phase 6 `WeekGrid`, day list on phones) and *My subjects and teachers*. That list is derived from the same entries (subject, teachers, lessons a week); no new relationship is stored.
- *Attendance* — the Phase 7/8A page:
  - each cell now also carries the lesson's teacher (D‑90);
  - a "Show each lesson" list shows date, period, subject, teacher and status;
  - the percentage is still P ÷ (P + A).
- *Marks & results* — the Phase 8B student results page, now at `/portal/results`, with the same visibility rules (D‑74). The staff *Results* page no longer serves students.
- *Behaviour* and *Achievements* — see below.

**Security:**
- `/portal/*` endpoints take no student id and refuse staff.
- Shared endpoints with an id refuse any other student with the same 403 as a missing record.
- Students hold no write permissions, and crafted writes return 403 (tested).

## Behaviour (BR‑BEH‑01…05)

**Data model** — migration `0011` (database-design.md §5g):
- `behaviour_sheets`: one per exam and section, DRAFT/SUBMITTED, with a revision.
- `behaviour_assessments`: one per sheet and student placement, with an optional remark of up to 300 characters.
- `behaviour_ratings`: one per assessment and configured category; the rating is 1–5 and the configured label is copied in at submission and correction (D‑84).
- Categories and labels always come from the Phase 4 configuration; nothing is hard-coded.

**Workflow** (D‑82):
- **Save draft** (staff only) → **Submit**, which requires every on-roll student to have a rating in every active category, then publishes the sheet to its students.
- A submitted sheet is **corrected in place**:
  - every correction needs a reason of at least 5 characters;
  - every active category must stay rated;
  - the sheet stays submitted, and students see the corrected values.
- There is no unlocked/hidden state. Behaviour has no derived results to protect, unlike marks.
- Concurrent edits are refused with a "reload" message (revision check).

**When:** the exam must be active and OPEN, and the year not closed; the class must take the exam. Closing the exam freezes behaviour (D‑83).

**Who** (D‑81, closes D‑13):
- Administrators: any section.
- The class teacher of the section in that year, with `behaviour.manage`.
- Subject teachers never.

**Visibility:**
- Students see only SUBMITTED assessments of active, non-draft exams, and only their own.
- Staff see drafts, labelled as such.

**UI:**
- Staff *Behaviour* page:
  - year → exam → class, then a table of students × configured categories (a dropdown per category showing "n — label", D‑86) plus a remark;
  - cards on phones;
  - Save draft, Submit (with confirmation), and a correction reason dialog;
  - history;
  - setup problems are shown when categories or labels are missing.
- Student *My behaviour*: one card per exam showing category, rating "n/5", label and remark.
- Empty state: "No behaviour assessment has been published for you yet."

## Achievements (BR‑ACH‑04…07)

**Data model:** `achievements` records:
- the student, the academic year and the placement on the date (the date must lie in the year and the student must be placed then);
- the category (must be active), title (≤ 120 characters), description (≤ 1000 characters) and date;
- `attachment_ref`, which is reserved;
- status ACTIVE or ARCHIVED.

**Authorisation:**
- Administrators manage any achievement.
- Class teachers manage achievements of students placed in their own section that year.
- A class teacher cannot tell whether a student outside their class exists.
- Subject teachers have no access.
- Students can read only their own ACTIVE achievements.

**Safety** (D‑87):
- Archive and restore are available to administrators and class teachers, with confirmation. Archived achievements are hidden from the student and cannot be edited.
- Only administrators can delete permanently, and only an archived achievement.
- Every change is audited.

**Attachments** (D‑88): not built, because the project has no file-storage facility yet. The column is reserved, the UI shows an indicator when it is set, and the add dialog says certificates stay with the office.

**UI:**
- Staff *Achievements* page:
  - filters for year, class, category, from/to, status and search;
  - cards and pagination;
  - an add/edit dialog with a student search through the existing scoped student list;
  - archive/restore/delete confirmations.
- Student *My achievements*: cards. Empty state: "Your achievements will appear here once they are recorded."
- The administrator's **student profile** now shows the student's behaviour assessments and achievements.

## Audit
Every event records the actor and time automatically.

| Entity | Action | What is recorded |
|---|---|---|
| `behaviour_sheet` | `behaviour.recorded`, `behaviour.corrected` | Year, exam, class/section, student and placement; per category, old → new (with labels); remark old → new; the reason for corrections |
| `behaviour_sheet` | `behaviour.submitted` | Student count, categories and the labels in force |
| `achievement` | `achievement.created`, `.updated`, `.archived`, `.restored`, `.deleted` | Before and after snapshots: student, year, class, category, title, description, date, status |

No credentials are logged.

## Permissions (D‑85)
No new keys.

| Key | Used for |
|---|---|
| `students.view` | The student's own profile |
| `behaviour.view` | Students: own submitted assessments; class teachers: own section; admins: all |
| `behaviour.manage` | Recording, submitting and correcting behaviour (own section for class teachers) |
| `achievements.view` | Reading achievements, scoped as above |
| `achievements.manage` | Adding, editing, archiving and restoring (own section for class teachers); admins delete |

Correction is distinguished by the mandatory reason, not by a separate key.

## Other changes
- A student with marks, behaviour assessments or achievements is no longer offered for deletion (BR‑ST‑10 now counts Phase 8B/9 history).
- `useLeaveGuard` is reused for unsaved behaviour ratings.

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (lint, format, typecheck, unit, integration, component) | clean — **384 tests in 29 files** (Phase 8B: 371) |
| API `phase9.test.ts` (3 × SQLite and PostgreSQL) | Portal, behaviour and achievements; see the breakdown below |
| API `attendance.test.ts` | updated for the teacher in student attendance cells |
| Mutation checks | showing behaviour drafts to students fails the behaviour test; letting staff see achievements outside their sections fails the achievements test |
| Web `portal.test.tsx` (7) | student menu, overview and read-only profile; timetable subjects and teachers; behaviour and achievements empty states and cards; staff/student page refusals; behaviour columns from configured categories, save body, submit confirmation; correction needs a reason; achievement add dialog validation, inactive category hidden, POST body, archive confirmation |
| Web (existing) | menu lists and student results path updated (`/portal/results`) |
| `pnpm --filter @ttlmhss/web test:e2e` | **54/54** (4 new in `portal.spec.ts`); see the breakdown below |
| `pnpm build` | builds |
| Migrations | `0011` applies, rolls back and re-applies on both providers; applied to the development database |
| Manual | screenshots of the portal, behaviour (desktop and phone) and achievements reviewed |

**API tests (`phase9.test.ts`):**
- *Portal:* the student's own profile has no secrets or admin data; signed out → 401; staff → 403; another student's profile, timetable, attendance, result and behaviour → 403, the same as a missing student; crafted writes to student details, marks and attendance → 403; the timetable, attendance (via a teacher's register) and 8B results work.
- *Behaviour:*
  - the class teacher's options cover their own section only, with configured categories and labels;
  - another section, a subject teacher and a student are refused, as is a student of another section;
  - invalid ratings (0 and 6) and an inactive category are refused;
  - a draft is hidden from the student and an incomplete sheet cannot be submitted;
  - a stale revision is refused;
  - submit makes the assessment visible with its labels, and a later label change does not rewrite it;
  - corrections need a reason and must keep every rating; a correction is visible to the student and audited old → new;
  - the history works, an administrator can edit any section, and the staff per-student view works;
  - closing the exam freezes behaviour.
- *Achievements:*
  - admin creates for any student; the class teacher creates for their own section, and other students are refused the same as unknown ones;
  - subject teachers and students are refused;
  - an inactive or unknown category, a date outside the year and an empty title are refused;
  - lists are scoped;
  - students see only their own;
  - an edit is audited with before/after;
  - deletion requires archiving first and is admin-only;
  - archiving hides the achievement and blocks edits;
  - the full audit set is checked.

**New browser tests (`portal.spec.ts`):**
- The class teacher rates the class, saves a draft (the student's API shows nothing) and submits (now visible).
- The class teacher adds an achievement through the dialog.
- The student goes through My portal, profile, timetable subjects and teachers, attendance, marks & results, behaviour and achievements; another student's data returns 403 on four endpoints; writes are refused; staff pages are refused.
- At 820 and 390 px there is no page overflow on five portal pages, and the behaviour sheet becomes cards on phones.

## Out‑of‑scope check
Not built: dashboards, announcements, notifications, requests of any kind, report-card or annual PDFs, attendance exports, parent accounts, chat, fees, transport, library, hostel, payroll, timetable substitutions, new exam rules or annual weighting.

## Known limitations / future dependencies
- **Attachments (D‑88):** no certificate/image upload until a storage decision, likely with Phase 11 documents.
- **Class teacher scope covers the current year only:** past-year behaviour and achievements are administrator-only (existing class-teacher scope model).
- **Electives (D‑09) still open:** every student in a section is assessed in every configured category and subject.
- **Phase 10:** dashboards and announcements may link to the portal pages; student requests (e.g. result clarification) are not built.
- **Phase 11:** the annual report can read behaviour (year, exam, category, rating, stored label, remark, submitted state) and achievements (year, category, title, description, date, attachment reference) directly.

## Decisions requiring approval
- **D‑81:** class teacher of the section plus administrators record behaviour.
- **D‑82:** Draft → Submitted, with in-place, reason-required corrections and no unlock state.
- **D‑83:** behaviour follows the exam's OPEN stage.
- **D‑85:** no new permission keys.
- **D‑86:** a dropdown per category instead of radio buttons.
- **D‑87:** archive/restore; delete only by an administrator, after archiving.
- **D‑88:** attachments deferred.
