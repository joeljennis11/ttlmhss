# Phase 10 — Dashboards, Announcements & Requests

**Date:** 2026‑10‑05
**Status:** Complete. Awaiting the next instruction (Phase 11 not started).

## Objective
Three areas that together make the school's operational home screens:
- **Role dashboards** — an actionable launchpad per role ("what do I need to do today?"), not an analytics page.
- **Announcements** — informational notices for a structured audience.
- **Structured requests** — students ask for a review of attendance, a result or profile details; reviewers handle them in scope.

## Starting state
- Phase 9 was committed (`1d3e2e7`) with 384 tests and 54 browser tests.
- Home showed only "You are signed in as …" and an account panel.
- The permission keys `announcements.view/manage` and `requests.view/create/handle` already existed (Phase 2). `RequestType` existed; `RequestStatus` was a placeholder (OPEN/RESOLVED/REJECTED, unused).

## Dashboards (BR‑DASH‑01, D‑91 … D‑93)

**One source of truth.** Dashboards consume the existing source‑of‑truth services. `GET /dashboard` (one call per home page) is composed ONLY by calling the existing services with the caller's own identity. Nothing is recalculated, so a number on a card always equals the number on the page it links to. A block the caller is not allowed to see (an administrator may have adjusted permissions, a student may not be placed) is left out instead of failing — the dashboard never widens access.

| Block | Shown to | Data source (existing service) |
|---|---|---|
| Counts | Administrators | Totals of the Students and Teachers list queries (status ACTIVE); active classes/sections from configuration; open requests from the request service |
| Today | Administrators | Working status: `CalendarResolver`; notes: today's calendar entries; attendance: new read‑only `AttendanceViewService.schoolDay` = the class‑day lesson logic (timetable in force + saved registers, calendar applied) for every active section, counts by `countAttendance` |
| Exams and marks | Administrators | `MarkSheetService.home` (Phase 8B sheet states) for exams not closed |
| Today's lessons | Teachers | `AttendanceViewService.lessons` — the same view as *My lessons*; rendered with the Phase 7 `LessonList` (Take / Open / View attendance by register state) |
| Mark entry | Teachers | `MarkSheetService.home` (sheets the teacher is the authorised entry teacher of, open exams) and `MarkSheetService.sheet` for completeness |
| My class (one per own section) | Class teachers | `AttendanceViewService.classDay`, `MarkSheetService.home`, `BehaviourService.sheet`, `AchievementService.list`, active placements |
| Student home | Students | `PortalService.profile`, new `AttendanceViewService.myDay` (today's lessons + own status), `myAttendance` (same range as *My attendance*: today and the 27 days before), `ResultsService.myExams/myResult` (Phase 8B visibility), `BehaviourService.mine`, `AchievementService.mine` |
| Announcements | Everyone | `AnnouncementService.feed` |
| Requests | Reviewers / students | `RequestService.list` / `mine` |

**Calendar:** on a holiday, no lessons are listed and nothing is "pending" (tested); special working days use the timetable in force, like attendance.

**Mark‑task states (D‑92):** Not started (no marks entered yet — assigning a teacher creates an empty draft) → Draft → Ready to submit (every student entered) → Submitted; an unlocked sheet is *Needs correction*. Only sheets the teacher is authorised for appear (Phase 8B authorisation).

**UI:**
- Administrator: numbers that open their page (active students, teachers, classes/sections, open requests), quick actions (Add student, Add teacher, Timetable, Attendance, Exams, Marks, Academic calendar, Announcements, Requests — each shown only with its permission), *Today* (registers taken, counts, sections still to take with "Open class day"), *Exams and marks*, announcements, open requests.
- Teacher: today's lessons with the real attendance action, pending mark entry (submitted counted), announcements.
- Class teacher: the teacher blocks plus one *My class* panel per own section (students, today's attendance and registers not taken, exams with subjects submitted and behaviour state, recent achievements, quick actions to the existing pages), announcements and the section's open requests.
- Student: a phone‑first home that does not look like the staff layout — class banner, Today (time, subject, teacher, own status), Attendance (large percentage, P/A), Latest result, Behaviour, Achievements, My requests, Announcements and portal link chips.
- Empty states: "No announcements right now.", "You have no open requests.", "No pending mark-entry tasks.", "No achievements recorded yet.", "No behaviour assessment has been published yet.", "No lessons scheduled."
- Responsive: cards and grids on desktop, compact grids on tablets, stacked cards on phones; no wide tables; no sideways scrolling (tested at 820 and 390 px).

## Announcements (BR‑AN‑01 … 04, D‑96)

**Model** — migration `0012`, table `announcements`: title (≤ 120), message (≤ 4000), academic year (the current one at creation), **structured audience** — `SCHOOL`, `STAFF`, `CLASS` (+ class), `SECTION` (+ section and its class, composite key) with a CHECK that a row can never be half‑targeted — status, published at/by, optional expiry date, author, timestamps.

**Audience (who reads):**
- Whole school → everyone.
- Teachers and staff → teachers and administrators (never students).
- A class → students placed in any of its sections and their class teachers.
- A section → its students and its class teacher.
- Administrators read every audience. Subject teachers do not see class/section announcements.

**Who writes:**
- Administrators — any audience.
- Class teachers (`announcements.manage`) — only their own section in the current year. Not another section, not the whole class, staff or the school (no existing permission allows wider).
- Subject teachers and students — no management.

**Lifecycle:** Draft (managers only) → Published (its audience, from publication) → Archived (hidden, kept as history; restore returns it to Published or Draft). No deletion. Optional *Show until* date (inclusive, not in the past) hides a published announcement afterwards; managers see it marked *Expired*. "Publish now" or save a draft — no scheduled publishing, no notifications.

**UI:**
- *Announcements* (everyone): the active announcements of their audience as cards (title, date, audience, author, preview); each opens the full announcement page.
- *Manage announcements* (administrators, class teachers): year, status, audience and title filters; cards with Edit, Publish, Archive (confirmation), Restore; a dialog with Title, Message, Audience (only the allowed ones), Class or Section when needed, Show until, Publish now.

## Requests (BR‑RQ‑01 … 06, D‑94, D‑95, D‑97)

**Model** — table `requests`:
- Type, status, academic year, student and the **placement at creation** (enrolment + section — fixes the scope), requester and role, a server‑written summary, description (10–2000).
- Typed references (CHECKed per type): attendance issue → date + period (+ the lesson's subject); result clarification → exam + subject; profile correction → detail category (`ProfileField`).
- Assignee, resolution note, resolved at/by, closed at/by, revision, timestamps.
- The status and assignment history is the audit trail (no separate history table).

**Types and what the server checks:**
- *Attendance issue* — a date in the year, not in the future, and a period in which the student really had a lesson that day (`AttendanceViewService.myDay`, calendar‑aware). The form lists that day's lessons with the current mark.
- *Result clarification* — an exam whose results the student may see and one of its subjects for the student (`ResultsService`).
- *Profile correction* — which detail looks wrong (name, date of birth, gender, parents/guardian, contact, address, admission details, class/section/roll, other).

**Lifecycle (D‑94):** Open → In review → Resolved → Closed, and reopen → Open:
- *Start review* makes the reviewer the assignee if there is none.
- *Resolve* needs a note the student sees.
- *Close* is allowed after Resolved, or earlier with a note (e.g. a duplicate).
- *Reopen* needs a reason; the old resolution stays in the history.
- Every change checks the revision, so two reviewers cannot overwrite each other.
- There is no *Rejected* state: "no change needed" is a resolution note.

**Routing (D‑95):**

| Type | Goes to | Also visible to |
|---|---|---|
| Attendance issue | Class teacher of the student's section (assigned automatically) | Administrators |
| Result clarification | Class teacher of the student's section | Administrators |
| Profile correction | Administrators (office queue) | — |

Subject teachers have no access. Only administrators re‑assign, to an administrator or the section's class teacher.

**Security:**
- Students create and read only their own requests (ids from the session). Another student's request → 403, the same as a missing id.
- Students cannot change status, assign or resolve (403).
- Class teachers see and handle their own section's attendance/result requests only; administrators everything.
- At most 10 Open/In‑review requests per student (D‑97).

**No back door (BR‑RQ‑05):** handling a request changes only the request. The review page links to the record's own page — the class attendance day, the class results, or the student profile (administrators) — where corrections follow their usual rules and audits. Tested: attendance records, mark entries and the student row are byte‑for‑byte unchanged after a full workflow.

**UI:**
- *My requests* (students): list (type, summary, reference, sent / updated, status) and *New request* with a form that changes by type.
- *Requests* (reviewers): filters for year, status, type, class and sent from/to.
- A shared request page: details, description, resolution, *Start review*, *Resolve*, *Close*, *Reopen*, assignment (administrators) and history.

## Audit
Every event records the actor and time (existing `AuditRecorder`, in the same transaction). No credentials are logged.

| Entity | Actions | What is recorded |
|---|---|---|
| `announcement` | `announcement.created`, `.published`, `.updated`, `.retargeted` (audience changed), `.archived`, `.restored` | Before/after: title, message, audience, class, section, status, expiry; publish time |
| `request` | `request.created`, `.review_started`, `.assigned`, `.resolved`, `.closed`, `.reopened` | Type, student, year, section, summary, references, description, assignee; status/assignee/resolution before → after; the note as the reason |

## Permissions (D‑98)
No new keys — see permissions.md §15.
- `announcements.view` — read your own audience.
- `announcements.manage` — admins all; class teachers their own section.
- `requests.view` — students their own; class teachers their own section; admins all.
- `requests.create` — students.
- `requests.handle` — status changes; assignment is admin‑only.

All checks are server‑side; menus only hide what the server refuses anyway.

## Other changes
- Shared controlled values: `RequestStatus` is now OPEN/IN_REVIEW/RESOLVED/CLOSED (it was an unused placeholder), plus `AnnouncementAudience`, `AnnouncementStatus` and `ProfileField` with labels.
- Attendance views: read‑only `schoolDay` (administrators) and `myDay` (students, `GET /attendance/me/day`).
- `UserAccountRepository.listActiveByRole` provides the administrators a request can be assigned to.
- Navigation: Announcements for everyone; Requests for administrators and class teachers; My requests for students. Home is now the dashboard; the Phase 3 placeholder home page was removed.

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (lint, format, typecheck, unit, integration, component) | clean — **411 tests in 31 files** (Phase 9: 384) |
| API `phase10.test.ts` (10 × SQLite and PostgreSQL) | dashboards, announcements and requests; see the breakdown below |
| Mutation checks | showing drafts in the announcement feed fails the announcements test; letting class teachers see profile corrections fails the reviewers test; a different attendance range on the student dashboard fails the student dashboard test |
| Web `phase10.test.tsx` (7) | admin dashboard numbers, links and quick actions; teacher lessons with the real Take attendance link and pending mark entry; the student home (own data, empty states, portal links, no staff layout); the class teacher announcement dialog (own section only, validation, POST body); archive confirmation and the full announcement page; the student attendance‑issue form (lessons of the chosen day, structured body, no review controls); a reviewer resolving with a note |
| Web (existing) | menu lists updated for the new entries |
| e2e (existing) | `timetable.spec.ts` responsive test given 60 s instead of 30 s: five full week‑grid loads with every spec file's periods in the shared database took 31 s; no assertion changed |
| `pnpm --filter @ttlmhss/web test:e2e` | **62/62** (8 new in `requests-announcements.spec.ts`); see the breakdown below |
| `pnpm build` | builds (web JS 783 KB / 214 KB gzip) |
| Migrations | `0012` applies, rolls back and re‑applies on both providers (data‑layer test); applied to the development database |
| Manual | screenshots of every dashboard (desktop and phone), the management page and the requests page reviewed |

**API tests (`phase10.test.ts`):**
- *Dashboards:*
  - signed out → 401;
  - administrator counts equal the Students list total;
  - today's attendance equals the sum of the class‑day counts;
  - pending sections and exam sheet states update after real register and marks saves;
  - other roles get no admin block;
  - the teacher's lessons equal `GET /attendance/lessons` exactly;
  - mark tasks move Not started → Draft / Ready to submit → Submitted → Needs correction (after a class teacher's unlock);
  - a class teacher who is not the entry teacher has no tasks;
  - a class teacher sees one panel for their own section only (no ids or names from the other section), with counts equal to the class day;
  - a student's attendance equals *My attendance* over the same range and their latest result equals `/results/me`;
  - no classmate data and no effect from crafted query parameters;
  - on a holiday: no lessons, nothing pending, for every role.
- *Announcements:*
  - feed per audience for six different users; draft hidden; staff‑only hidden from students;
  - class/section targeting; another section refused the same as an unknown id;
  - publish, archive (hidden), restore (visible again);
  - past expiry refused, shown through the expiry day and hidden the day after;
  - the class teacher's options and own‑section post; another section, a class, staff or the school → 403;
  - subject teacher and student cannot manage or list; validation 400;
  - editing outside scope → 403; a re‑target is audited as `announcement.retargeted`; the full audit sequence is checked.
- *Requests:*
  - student options (own section, visible exam + subjects); `/attendance/me/day`;
  - all three types created with server summaries and routing (class teacher / office);
  - a period that was not the student's lesson, a future date, an unknown subject and a short description are refused;
  - students see only their own (another's request = missing); student status/assign → 403; staff cannot create;
  - class teacher scope (own section, not profile corrections); another class teacher sees none; subject teacher → 403; administrator filters (section, type, created dates);
  - full workflow with stale‑revision refusal, note rules, reopen clearing the resolution;
  - history for staff, none for students; assignment rules;
  - attendance, marks and the student row unchanged; audit sequences; the limit of 10.

**New browser tests (`requests-announcements.spec.ts`)** — the user's 18 points:
1. The admin dashboard shows the real student total and today, and a quick action opens the calendar.
2–3. The teacher dashboard lists today's lesson; its attendance action opens the register.
4. The class teacher dashboard shows only their own class.
5–6. The student dashboard shows their own day; the dashboard JSON and page contain no other student.
7–8. The admin publishes a school‑wide announcement; the student reads it in full.
9–10. The class teacher posts to their own section (another section → 403); a student of the other class does not see it (list, API and direct address).
11–16. A student sends an attendance issue for today's lesson and sees it *Open*; the class teacher opens it, starts review, resolves it (history shown); the student sees *Resolved* and the resolution; a student status change → 403.
17. Dashboards, announcements and request pages at 820 and 390 px: no sideways scroll (student, teacher, class teacher).
18. All Phase 1–9 browser flows pass in the same run.

## Out‑of‑scope check
Not built:
- report‑card, annual or attendance PDFs; Excel; file storage;
- push/email/SMS notifications or scheduled publishing; chat or threads;
- parent accounts, fees, transport, library, hostel, payroll, substitutions;
- new exam rules, electives, annual weighting, AI reports;
- deployment work.

## Known limitations / future dependencies
- **No audit feed on the admin dashboard (D‑99):** no readable audit viewer exists yet — candidate for Phase 12.
- **Class teachers have no student list page (D‑100):** the class attendance day lists the class.
- **Routing uses the current placement:** a request made after a class change goes to the new class teacher; administrators see everything.
- **Scope is the current year only:** class‑teacher scope (requests, announcements) follows the existing current‑year assignment model; past‑year requests are administrator‑only.
- **No "available reports" card:** reports arrive with Phase 11.
- **Phase 11:** reports can read requests (type, references, dates, resolution) and announcements directly; dashboards can link to report pages when they exist.

## Decisions requiring approval
- **D‑94:** request lifecycle without *Rejected*; reopen with a reason.
- **D‑95:** routing — the class teacher for attendance and results, administrators for profiles; subject teachers have no access; admin‑only reassignment.
- **D‑96:** audiences SCHOOL / STAFF / CLASS / SECTION; class teachers own section only; publish now or draft; inclusive expiry date.
- **D‑97:** a limit of 10 waiting requests per student.
- **D‑99:** no audit feed on the dashboard for now.
