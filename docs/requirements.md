# Requirements — TTLMHSS

Thiruthangal Lions Matriculation Higher Secondary School — School Management System.

This document captures the complete functional and non‑functional requirements from the Phase 0 master specification. The phase column shows where each area is **planned** to be built; nothing here is implemented until its phase is unlocked.

Domain rules referenced here are defined authoritatively in [business-rules.md](business-rules.md). Access rules are in [permissions.md](permissions.md).

---

## 1. Product

- **R‑1.1** Modern, professional, clean, responsive, school‑oriented web application usable on desktop and mobile. Must not feel like a converted desktop app.
- **R‑1.2** Short name `TTLMHSS`; full name *Thiruthangal Lions Matriculation Higher Secondary School* shown in branding, headers and documents.
- **R‑1.3** Production quality: real end‑to‑end functionality (UI → API → backend → database). No mock features.

## 2. Branding (Phase 3, applied throughout)

> Status: login page, application shell, favicon and the official logo implemented in Phase 3 (architecture.md §11). PDF branding follows in Phase 11.

- **R‑2.1** Primary colour Dark Green `#003300` for sidebar, primary buttons, active nav, headers, accents, login branding, dashboard highlights, PDF branding.
- **R‑2.2** Derived tints/shades for hover, selected, borders, cards and highlights. White/light neutral content backgrounds. Not an all‑green UI. Accessible contrast.
- **R‑2.3** Official logo supplied by the user is the only logo. Never generated, redrawn, replaced or placeholder‑substituted. Used in: login, sidebar/header, dashboards, teacher and student portals, favicon, attendance reports, mark sheets, report cards, annual reports, official PDFs.

## 3. Roles & accounts (Phase 2, Phase 5)

- **R‑3.1** Roles: Admin, Teacher, Class Teacher, Student. No Parent account; no other roles.
- **R‑3.2** Class Teacher = Teacher with a class/section assignment granting extra scoped permissions.
- **R‑3.3** Teacher account auto‑created when Admin adds a teacher.
- **R‑3.4** Student account auto‑created when Admin admits a student. One student = one account.
- **R‑3.5** Secure temporary credentials and forced password change at first login. Password hashing; no plaintext storage. No public registration.
- **R‑3.6** Admin can reset credentials and deactivate accounts.

## 4. Admin & school configuration (Phase 4)

> **Status (Phase 4):** R‑4.1–R‑4.7, R‑4.9 implemented (School setup area, `/admin`). R‑4.8 (student profile fields) moves to Phase 5 with student management; R‑4.10 (audit log viewer) is not built — configuration changes are written to the audit log. Role permissions are configurable within fixed ceilings (permissions.md §8).

Admin configures:

- **R‑4.1** Academic years (create, set current, close/archive).
- **R‑4.2** Classes and sections (create, rename, order, deactivate/archive — never destructive delete when history exists).
- **R‑4.3** Subject master list.
- **R‑4.4** Period structure: period numbers, start/end times, breaks, active/inactive periods, working days.
- **R‑4.5** Attendance lock rules (e.g. month editable until N days into next month).
- **R‑4.6** Exam definitions, grade ranges, normalization rules, exam weightage, rank scope (Phase 8 for usage).
- **R‑4.7** Behaviour categories and 1–5 rating labels.
- **R‑4.8** Configurable student profile fields grouped as Personal, Parent/Guardian, Contact, Address, Academic, Other. Protected system fields stay application‑controlled.
- **R‑4.9** School details (name, address, contact, signatory names/titles for documents).
- **R‑4.10** Access to audit information.
- **R‑4.11** *(Phase 8A)* **Academic calendar:** per academic year, the weekly working days are the default; administrators add date entries — **Holiday** or **Working day** — for the entire school, a class range, specific classes or specific sections, with a reason and optional note; monthly calendar and list views; edit and delete with confirmation; every change audited. Whether attendance can exist for a class on a date comes from this calendar.

## 5. Student management (Phase 5)

> **Status (Phase 5):** R‑5.1, R‑5.3–R‑5.5 implemented; R‑5.6 implemented for administrators without photo and statistics (no photo upload yet; attendance/marks/behaviour/achievements arrive in later phases). R‑5.2 / R‑4.8 configurable fields: **not implemented** — the profile uses fixed field groups (D‑41). R‑5.7 out of scope.

- **R‑5.1** Add/admit, edit, view, search, filter, deactivate students. Delete only when no dependent records exist.
- **R‑5.2** Configurable profile fields per R‑4.8.
- **R‑5.3** Promotion: whole class/section and individual. Outcome statuses: Promoted, Transferred, Not Promoted, Left.
- **R‑5.4** Transfer between sections/classes.
- **R‑5.5** Academic history per student, preserved across years.
- **R‑5.6** Compact profile view: photo, name, admission/roll no., class, section, academic year, basic contact, quick statistics. Details in a modal/detail view: Personal, Parent/Guardian, Academic, Attendance, Marks & Results, Behaviour, Achievements.
- **R‑5.7** Student document management is **out of scope** for now.

## 6. Teacher management (Phase 5)

> **Status (Phase 5):** R‑6.1–R‑6.4 implemented.

- **R‑6.1** Add, edit, view, search, filter, deactivate teachers.
- **R‑6.2** Assign subjects from the subject master (Teacher → Subject, many‑to‑many).
- **R‑6.3** Assign/unassign a teacher as Class Teacher of a class/section for an academic year.
- **R‑6.4** No permanent teacher↔class binding for subject teaching; class association comes from the timetable.

## 7. Timetable (Phase 6)

- **R‑7.1** Full academic‑year weekly timetable.
- **R‑7.2** Assignment = Teacher + Subject + Class + Section + Day + Period; teacher must be assigned that subject.
- **R‑7.3** One assignment drives class, teacher and student timetables and the attendance context.
- **R‑7.4** Mandatory conflict prevention: teacher double‑booking; class/section period collision.
- **R‑7.5** Editing: drag‑and‑drop on desktop; tap period → select assignment → place on mobile.
- **R‑7.6** Draft → Save → Publish. Many edits before publish; only published timetable is live.
- **R‑7.7** Each period's primary action is **Take Attendance**. *(Phase 6: not shown yet — the action appears in Phase 7 when attendance exists; the timetable already exposes the context it needs, R‑7.10.)*
- **R‑7.8** *(Phase 6)* Timetables belong to an academic year; each year has at most one draft and one published version, and published versions are kept as history (never edited).
- **R‑7.9** *(Phase 6)* Breaks and inactive periods never hold lessons; the grid uses the Admin‑configured periods, breaks and working days of the year.
- **R‑7.10** *(Phase 6)* For any calendar date the published timetable yields each lesson's Date + Period + Class/Section + Subject + Teacher (the Phase 7 attendance context).

## 8. Attendance (Phase 7)

- **R‑8.1** Period‑wise attendance keyed by Date + Class/Section + Period + Student.
- **R‑8.2** Statuses: `-` Not Marked, `P`, `A`, `L`, `C`.
- **R‑8.3** Percentage = P / (P + A).
- **R‑8.4** Subject Teacher: open Take Attendance from a timetable period; context (date, period, class, section, subject, teacher) auto‑filled; students listed with default `-`; mark P/A; optional *Mark All Present*; may edit only own periods within cutoff.
- **R‑8.5** Class Teacher: view whole day for own class; edit authorized periods; multi‑period selection; apply Leave with reason (Medical / Personal / School Activity / Other + mandatory description for Other); mark periods Cancelled.
- **R‑8.6** Configurable locking cutoff; Admin override; every override audited.
- **R‑8.7** Full audit trail on every change (user, timestamp, student, date, period, old, new, reason).
- **R‑8.8** Student view: matrix with date rows × period columns, cells P/A/L/C/-.
- **R‑8.9** *(Phase 7)* `C` = **Permission / conditionally excused** for one student (Phase 7 instruction; replaces the earlier "Cancelled" wording, D‑51). Class Teachers apply Leave or C to several periods of one student's day at once.
- **R‑8.10** *(Phase 7)* One record per Academic Year + Date + Period + Student (database‑enforced); saving again updates it. Unmarked students stay `-`; nothing is converted to P or A automatically.
- **R‑8.11** *(Phase 7)* Today's timetable shows **Take attendance** only for the teacher's own published lessons (not breaks, free periods or other teachers' lessons); once saved it opens the saved register.
- **R‑8.12** *(Phase 7)* Class‑teacher views: class day (period × student matrix, absentees, leave, unmarked periods, %) and totals over a date range; administrator register search with filters and paging; student "My attendance" with date range and totals.
- **R‑8.13** *(Phase 7)* Two people saving the same register: the second save is refused with a "reload" message (no silent overwrite).

## 9. Exams, marks & results (Phase 8)

- **R‑9.1** Admin‑configurable exams (examples: 1st Mid‑Term, Quarterly, Half‑Yearly, 2nd Mid‑Term, Annual — not hard‑coded).
- **R‑9.2** Per exam: dates, subjects, max marks, pass marks, internal marks, practical marks, grade rules, normalization, annual weightage.
- **R‑9.3** Configurable weightage; never assume equal.
- **R‑9.4** Subject Teacher marks entry: Exam → Subject → Class/Section; table of Roll No, Student, Max Marks, Marks, Grade.
- **R‑9.5** `0` = actual zero/absent; `-` = not entered. No "AB" as primary absent representation.
- **R‑9.6** Save Draft and Submit; submit locks. Admin / authorized Class Teacher can unlock/edit; corrections audited.
- **R‑9.7** Configurable normalization (e.g. 42/50 → 84/100), original retained.
- **R‑9.8** Configurable grade ranges.
- **R‑9.9** Subject‑wise result visibility on submission (see business rules).
- **R‑9.10** Result page: exam, subject, marks, max marks, grade, total, percentage, rank shown as `4 / 42`; rank scope configurable (default class/section).

## 10. Behaviour & achievements (Phase 9)

- **R‑10.1** Exam/result‑based behaviour ratings, 1–5 radio buttons, configurable categories (e.g. Discipline, Participation, Punctuality, Cooperation, Overall Behaviour) and labels (e.g. 1 Needs Improvement … 5 Excellent), optional teacher remark.
- **R‑10.2** Achievements managed by Admin and Class Teacher only. Fields: category (Academic, Sports, Cultural, Competitions, Certifications, Other), title, description, date, optional certificate/image.
- **R‑10.3** Achievements shown on student profile and annual report.

## 11. Student portal (Phase 9)

- **R‑11.1** Student views own: profile, class, section, timetable, teachers, subjects, attendance, marks, results, annual performance, behaviour, achievements, announcements, reports, mark sheets.
- **R‑11.2** No editing of academic records.
- **R‑11.3** Download available reports/mark sheets (real PDFs).

## 12. Dashboards (Phase 10)

- **R‑12.1 Admin:** total students, total teachers, classes/sections, today's attendance, active/upcoming exams, pending requests, announcements, quick actions, optional monthly attendance overview.
- **R‑12.2 Teacher:** today's timetable, attendance actions, pending marks, assigned subjects/classes, announcements, requests.
- **R‑12.3 Class Teacher:** class overview, total students, today's attendance, today's timetable, upcoming exams, recent results, achievements, pending requests, quick actions.
- **R‑12.4 Student:** profile summary, today's timetable, attendance summary, latest submitted results, behaviour summary, achievements, announcements, available reports.

## 13. Announcements & requests (Phase 10)

- **R‑13.1** Simple announcements posted by Admin (any audience) and Class Teacher (own class), shown on relevant dashboards. No complex notification infrastructure.
- **R‑13.2** Simple student requests: Attendance Issue, Result Clarification, Profile Correction. Status lifecycle and a response note. No chat, no ticketing platform.

## 14. Reports, PDFs & annual report (Phase 11)

- **R‑14.1** Attendance reports: individual student, class/section, monthly, period‑wise, academic‑year.
- **R‑14.2** Academic: mark sheets, report cards, annual reports.
- **R‑14.3** Exports: PDF; Excel where appropriate.
- **R‑14.4** PDF standard: A4, logo, school name, academic year, student info, proper tables, `#003300` branding, readable print‑friendly layout, signatures and page numbers where applicable.
- **R‑14.5** Annual report aggregates academic performance (using configured weightage), exam results, attendance, behaviour, achievements, teacher/class‑teacher remarks. System may suggest a remark from marks/attendance/behaviour/achievements; Class Teacher edits/writes the final remark.

## 15. Non‑functional requirements

- **NFR‑1 Security:** secure authentication, password hashing, protected routes, backend RBAC with scope checks, input validation, parameterized queries/ORM, secure session handling, secrets in environment variables, rate limiting, audit logging.
- **NFR‑2 Data integrity:** protect history, academic‑year relationships, student identity, attendance, marks, results, timetable consistency, permissions and audit data. Archive/deactivate instead of destructive delete when dependents exist.
- **NFR‑3 Replaceable data layer:** database provider undecided; business logic decoupled from storage.
- **NFR‑4 Maintainability:** layered, modular structure; no giant files; typed code; tests for business rules.
- **NFR‑5 UX:** responsive, accessible contrast, clear navigation, consistent components, loading/empty/error states, confirmations, toasts, search, filters, pagination.
- **NFR‑6 Auditability:** attendance changes, lock overrides, marks unlock/corrections, promotions and permission‑relevant admin actions are audited.
- **NFR‑7 Privacy:** the system holds personal data of minors. Collect only needed fields, restrict access by role and scope, and keep audit trails.

## 16. Explicitly out of scope (unless later requested)

Parent accounts · public registration · student document management · chat/messaging · ticketing platform · complex notification infrastructure (push/SMS/email campaigns) · fees/finance · library · transport · hostel.
