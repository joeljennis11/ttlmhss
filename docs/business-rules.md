# Business Rules — TTLMHSS

Authoritative definitions of the domain rules. Each rule has an ID so code, tests and later phases can reference it (e.g. `// BR-ATT-03`). Rules marked **⚠ Open** have an unresolved detail tracked in [decisions.md](decisions.md); the stated default is the proposal until the user confirms.

---

## Academic year & history (BR‑AY)

- **BR‑AY‑01** Academic year is a core dimension. Enrolments, class‑teacher assignments, timetables, attendance, exams, marks, behaviour, achievements and reports all belong to an academic year.
- **BR‑AY‑02** Exactly one academic year is *current* at a time. Past years are read‑only except via audited Admin actions.
- **BR‑AY‑03** Moving a student to a new class, section or year **creates a new enrolment**; prior enrolments and all records tied to them are never modified or deleted.
- **BR‑AY‑04** The detailed rollover workflow is configurable and deferred; whatever it becomes, it must satisfy BR‑AY‑03.

## Classes, sections, subjects (BR‑CS)

- **BR‑CS‑01** Classes, sections and subjects are Admin‑configured data. No business logic may depend on a specific class name or count (e.g. never `if class == "10"`).
- **BR‑CS‑02** An entity with dependent historical records cannot be hard‑deleted; it is deactivated/archived. Deactivated entities remain visible in historical views and reports.

## Teachers (BR‑TCH)

- **BR‑TCH‑01** The primary relationship is **Teacher → Subject** (many‑to‑many). Subjects must come from the subject master.
- **BR‑TCH‑02** A teacher may teach the same subject to many classes; many teachers may teach the same subject.
- **BR‑TCH‑03** A teacher's classes are derived from timetable assignments, not stored as a permanent binding.
- **BR‑TCH‑04** A teacher becomes a **Class Teacher** by a class‑teacher assignment: (teacher, class‑section, academic year). Default proposal: at most one class teacher per section per year; a teacher may be class teacher of at most one section per year. **⚠ Open (D‑08)**

## Timetable (BR‑TT)

- **BR‑TT‑01** A timetable slot assignment = Teacher + Subject + Class + Section + Day + Period (within an academic year).
- **BR‑TT‑02** The assigned teacher must be assigned that subject (BR‑TCH‑01).
- **BR‑TT‑03** *Enter once, reflect everywhere*: the class timetable, teacher timetable, student timetable and attendance context are all **derived** from assignments. They are never stored or edited separately.
- **BR‑TT‑04** **No teacher double‑booking**: a teacher cannot have two assignments on the same day + period.
- **BR‑TT‑05** **No class collision**: a class‑section cannot have two assignments on the same day + period.
- **BR‑TT‑06** Conflicts are validated in the backend on save **and** on publish; the UI shows them but is not the enforcement point.
- **BR‑TT‑07** Workflow **DRAFT → SAVE → PUBLISH**. Edits accumulate in a draft; saving persists the draft without affecting live views; publishing makes it live atomically.
- **BR‑TT‑08** Only the published timetable drives live views and attendance.
- **BR‑TT‑09** Publishing a new version must not rewrite past attendance. Attendance records keep the teacher/subject context that applied when they were taken (versioned timetable with effective‑from date). **⚠ Open (D‑05)**
- **BR‑TT‑10** The primary action on a period is **Take Attendance**. Marks are never period‑based.
- **BR‑TT‑11** Periods (number, start/end time, breaks, active/inactive) are Admin‑configured. Breaks and inactive periods cannot hold assignments.

## Attendance (BR‑ATT)

- **BR‑ATT‑01** Attendance is **period‑wise**, keyed by **Date + Class‑Section + Period + Student**. There is no single daily attendance record; any "daily" figure is derived.
- **BR‑ATT‑02** Statuses:

  | Code | Meaning | In % ? |
  |------|---------|--------|
  | `-` | Not Marked (default) | Excluded |
  | `P` | Present | Numerator & denominator |
  | `A` | Absent | Denominator |
  | `L` | Leave | Excluded |
  | `C` | Cancelled | Excluded |

- **BR‑ATT‑03** **Attendance % = P ÷ (P + A) × 100.** If P + A = 0, the percentage is "not available", never 0% or 100%.
- **BR‑ATT‑04** Subject Teacher opens attendance from a published timetable period. Date, period, class, section, subject and teacher are fixed by the system, not chosen freely.
- **BR‑ATT‑05** Subject Teacher may set only `P` or `A` (or revert to `-`), only for periods they are assigned, only for the day (dates on which that period occurs), and only before the lock cutoff. *Mark All Present* sets every currently unmarked student to `P`.
- **BR‑ATT‑06** Class Teacher may view all periods of the day for their own class‑section, edit any period of their class (before cutoff), select multiple periods at once, apply **Leave** and mark **Cancelled**.
- **BR‑ATT‑07** **Leave** (per student, per period(s)) requires a reason: Medical, Personal, School Activity, Other. **Other requires a free‑text description.**
- **BR‑ATT‑08** **Cancelled** applies to a whole period for a class‑section on a date (all students in it), not to a single student. Default proposal: a reason note is optional.
- **BR‑ATT‑09** Precedence: `L` and `C` set by Class Teacher/Admin cannot be overwritten by a Subject Teacher. A Subject Teacher sees them as read‑only. **⚠ Open (D‑06)**
- **BR‑ATT‑10** Only students actively enrolled in the class‑section on that date appear in the register.
- **BR‑ATT‑11** **Locking** is configurable. Default model: attendance for month *M* is editable until day *N* of month *M+1* (example: September editable until 7 October, locked from 8 October). Future dates cannot be marked.
- **BR‑ATT‑12** After lock, only Admin can change attendance (**override**). An override requires a reason.
- **BR‑ATT‑13** **Every** attendance change (including the first marking and every override) writes an audit entry: user, timestamp, student, date, period, old status, new status, reason.
- **BR‑ATT‑14** Student view is a matrix: rows = dates, columns = periods, cells = `P / A / L / C / -`.

## Exams (BR‑EX)

- **BR‑EX‑01** Exams are Admin‑configured per academic year. Names like Quarterly or Half‑Yearly are data, never code.
- **BR‑EX‑02** Each exam defines its subjects per class and, per subject: max marks, pass marks, optional internal and practical components, grade scheme, normalization, and its annual weightage.
- **BR‑EX‑03** **Weightage is explicit and configurable.** The system never assumes equal weightage. Weightages for exams counted in the annual result must total 100%; the system validates this before annual results are computed.
- **BR‑EX‑04** Exams not included in the annual calculation have weightage 0 (e.g. mid‑terms, if the school chooses).

## Marks (BR‑MK)

- **BR‑MK‑01** Marks are **subject‑wise**: entered per Exam → Subject → Class‑Section.
- **BR‑MK‑02** `-` means **not entered** (null). `0` means an actual zero, **which also represents absence**. "AB" is not used as the primary absent representation. **⚠ Open (D‑07)** — whether to additionally store an internal "absent" flag behind `0` for reporting.
- **BR‑MK‑03** Marks must be between 0 and the configured maximum (per component).
- **BR‑MK‑04** **Save Draft** stores marks without making them visible. **Submit** requires every enrolled student to have a value (no `-`), then **locks** the subject sheet.
- **BR‑MK‑05** A locked sheet can be unlocked only by Admin or the Class Teacher of that class‑section. Every unlock and every post‑submission correction is audited (who, when, student, old, new, reason).
- **BR‑MK‑06** Subject Teachers can enter marks only for subjects they teach to that class‑section according to the timetable (or an explicit marks assignment if D‑09 decides so).

## Normalization & grades (BR‑GR)

- **BR‑GR‑01** Normalization is configured by Admin (e.g. 42/50 → 84/100). The **original raw mark is always stored**; normalized values are derived.
- **BR‑GR‑02** Grade ranges are configured (e.g. A+ 90–100, A 80–89). Ranges must be contiguous and non‑overlapping across 0–100. Grades are computed from the percentage, never typed.
- **BR‑GR‑03** Rounding rules for percentages/normalized marks are configured once and applied consistently. **⚠ Open (D‑10)**

## Results & visibility (BR‑RS)

- **BR‑RS‑01** **Subject‑wise visibility:** a subject result becomes visible to the student **as soon as that subject is submitted**. Example: Maths submitted → Maths visible; Physics not submitted → Physics shown as "not yet available".
- **BR‑RS‑02** Visibility never waits for all subjects.
- **BR‑RS‑03** If a submitted subject is later unlocked for correction, default proposal: the student continues to see the last submitted values until the corrected sheet is resubmitted. **⚠ Open (D‑11)**
- **BR‑RS‑04** Totals, overall percentage and **rank** are shown only when all subjects required for that exam are finalized (a partial total would mislead).
- **BR‑RS‑05** Rank format `4 / 42` (position / number ranked). Scope configurable, default class‑section. Tie‑handling default: standard competition ranking (1, 2, 2, 4). **⚠ Open (D‑12)**
- **BR‑RS‑06** A full report card is available only once the required results are finalized/published by the workflow.

## Behaviour (BR‑BH)

- **BR‑BH‑01** Behaviour is recorded **per exam/result period**, not daily.
- **BR‑BH‑02** Each configured category is rated **1–5** via radio buttons. Labels are configurable (default: 1 Needs Improvement, 2 Below Expectations, 3 Satisfactory, 4 Good, 5 Excellent).
- **BR‑BH‑03** Optional teacher remark.
- **BR‑BH‑04** Default proposal: Class Teacher (and Admin) records behaviour for their class. **⚠ Open (D‑13)**

## Achievements (BR‑ACH)

- **BR‑ACH‑01** Only **Admin** and **Class Teacher** (for own class) can create/edit/delete achievements. Subject Teachers cannot.
- **BR‑ACH‑02** Fields: category (Academic, Sports, Cultural, Competitions, Certifications, Other), title, description, date, optional certificate/image.
- **BR‑ACH‑03** Achievements appear on the student profile and the annual report.

## Annual report (BR‑AR)

- **BR‑AR‑01** Aggregates academic performance using **configured exam weightage**, exam results, attendance (BR‑ATT‑03), behaviour, achievements and remarks.
- **BR‑AR‑02** The system may **suggest** a remark from marks, attendance, behaviour and achievements. The Class Teacher writes/edits the **final** remark; suggestions are never published without a human save.

## Students, accounts, promotion (BR‑ST)

- **BR‑ST‑01** One student = one account, created automatically on admission. Teacher accounts likewise on creation.
- **BR‑ST‑02** New accounts get temporary credentials and must change password at first login.
- **BR‑ST‑03** **Student isolation:** a student can access only their own records. Every student‑facing query is scoped by the authenticated student's ID **in the backend**; IDs from the client are never trusted for this.
- **BR‑ST‑04** Students never edit academic records. Profile corrections go through a Profile Correction request.
- **BR‑ST‑05** Promotion outcomes: **Promoted, Transferred, Not Promoted, Left**. Supports whole class‑section and individual promotion. Promotion creates new enrolments (BR‑AY‑03).
- **BR‑ST‑06** Transferred/Left students' accounts are deactivated (default proposal) but their records remain.
- **BR‑ST‑07** Protected system fields (IDs, admission number, account linkage, enrolment status) are controlled by the application, not by configurable field definitions.

## Requests & announcements (BR‑RQ)

- **BR‑RQ‑01** Request types: Attendance Issue, Result Clarification, Profile Correction. Lifecycle: Open → Resolved / Rejected, with a response note. No threaded chat.
- **BR‑RQ‑02** Default routing proposal: requests go to the student's Class Teacher; Admin sees all. **⚠ Open (D‑14)**
- **BR‑RQ‑03** Announcements: Admin can target all / role / class; Class Teacher targets own class only.

## Authentication & accounts (BR‑AUTH) — implemented in Phase 2

- **BR‑AUTH‑01** No public registration. Accounts are created by the school: the first Administrator through the operator CLI (`pnpm account create-admin`), all others by Admin workflows (Phase 5).
- **BR‑AUTH‑02** Account roles are ADMIN, TEACHER, STUDENT. **CLASS_TEACHER is derived**, never stored: a TEACHER with an ACTIVE class‑teacher assignment in the CURRENT academic year holds both TEACHER and CLASS_TEACHER. Removing the assignment removes the extra role and scope on the next request.
- **BR‑AUTH‑03** Usernames are case‑insensitive (stored lowercase; letters, digits and `. _ @ -`). What a username looks like for students/teachers is open (D‑22).
- **BR‑AUTH‑04** Passwords are never stored or logged in plaintext and never returned by the API. Hashes use Argon2id.
- **BR‑AUTH‑05** New passwords: 8–128 characters, at least one letter and one digit, no leading/trailing space, not a common password, must not contain the username, must differ from the current password, confirmation must match.
- **BR‑AUTH‑06** New accounts and password resets get a **temporary password** (shown once to the issuer). A user with a temporary password can sign in but cannot use anything except viewing their identity, changing the password and signing out until they choose their own password. Calling other endpoints directly does not bypass this.
- **BR‑AUTH‑07** Changing the password requires the current one and signs the user out of every other session.
- **BR‑AUTH‑08** Sign‑in failure messages never reveal whether the username exists, the password was wrong, or the account is inactive.
- **BR‑AUTH‑09** Inactive accounts cannot sign in; deactivating an account ends its sessions immediately.
- **BR‑AUTH‑10** Sessions end on sign‑out, after the idle timeout (default 2 h without activity) and after the absolute lifetime (default 12 h).
- **BR‑AUTH‑11** Repeated failed sign‑ins lock that username for a period (default 5 failures → 15 minutes); sign‑in requests are also rate‑limited per client.
- **BR‑AUTH‑12** Sign‑in success and failure, sign‑out, password changes, temporary‑password issue and account creation/activation/deactivation are audited — without passwords or tokens.
- **BR‑AUTH‑13** Authorization is enforced by the API: permission per role **and** record‑level scope (Admin school‑wide; Class Teacher own class/section; Student self only). Hidden buttons are never the protection. See docs/permissions.md.
