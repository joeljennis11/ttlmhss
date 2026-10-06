# Database Design — TTLMHSS

§1–§4 are the **conceptual model** (Phase 0). §5–§8 describe the **physical schema actually implemented** (Phase 1) and how the remaining entities will be added. The database provider is still **not finalised** (D‑04): the schema runs unchanged on SQLite and PostgreSQL, and both are tested.

---

## 1. Entity overview

```mermaid
erDiagram
    USER ||--o| TEACHER : "is"
    USER ||--o| STUDENT : "is"
    ACADEMIC_YEAR ||--o{ ENROLMENT : has
    CLASS ||--o{ SECTION : has
    SECTION ||--o{ ENROLMENT : contains
    STUDENT ||--o{ ENROLMENT : "has history of"
    TEACHER }o--o{ SUBJECT : "TEACHER_SUBJECT"
    TEACHER ||--o{ CLASS_TEACHER_ASSIGNMENT : holds
    SECTION ||--o{ CLASS_TEACHER_ASSIGNMENT : "has"
    TIMETABLE_VERSION ||--o{ TIMETABLE_SLOT : contains
    TIMETABLE_SLOT }o--|| TEACHER : "taught by"
    TIMETABLE_SLOT }o--|| SUBJECT : "for"
    TIMETABLE_SLOT }o--|| SECTION : "for"
    TIMETABLE_SLOT }o--|| PERIOD : "at"
    ATTENDANCE_SESSION ||--o{ ATTENDANCE_RECORD : has
    ATTENDANCE_SESSION }o--|| SECTION : "for"
    ATTENDANCE_SESSION }o--|| PERIOD : "at"
    ATTENDANCE_RECORD }o--|| ENROLMENT : "for"
    ATTENDANCE_RECORD ||--o{ ATTENDANCE_AUDIT : "changed by"
    EXAM ||--o{ EXAM_SUBJECT : includes
    EXAM_SUBJECT ||--o{ MARK_SHEET : "per section"
    MARK_SHEET ||--o{ MARK_ENTRY : has
    MARK_ENTRY }o--|| ENROLMENT : "for"
    EXAM ||--o{ BEHAVIOUR_RATING : has
    BEHAVIOUR_RATING }o--|| ENROLMENT : "for"
    STUDENT ||--o{ ACHIEVEMENT : earns
    STUDENT ||--o{ STUDENT_REQUEST : raises
```

## 2. Entities

### Identity & access
- **User** — login identity: username, password hash, role (Admin/Teacher/Student), status (active/inactive), must‑change‑password flag, last login. One user ↔ at most one Teacher or one Student.
- **Session** — server‑side session records (if server sessions are chosen).
- **AuditLog** — generic append‑only audit: actor, action, entity type/id, before/after, reason, timestamp.

### School structure & configuration
- **SchoolSettings** — name, address, contact, signatories, logo reference, other single‑row settings.
- **AcademicYear** — label (e.g. 2026–27), start/end dates, status (upcoming/current/closed).
- **Class** — e.g. LKG…XII; display order; active flag. *No class names in code.*
- **Section** — belongs to a Class (e.g. 10‑A); active flag. Per‑year applicability **⚠ Open (D‑21)**.
- **Subject** — subject master: name, code, active flag. (Elective/stream support **⚠ Open (D‑09)**.)
- **Period** — number, label, start/end time, is‑break, active flag; working days. Possibly versioned per academic year.
- **AttendanceLockRule** — cutoff configuration (e.g. day N of following month).
- **GradeScheme / GradeBand** — named scheme with ordered bands (label, min %, max %).
- **NormalizationRule** — from‑max → to‑max scaling and rounding rule.
- **BehaviourCategory / BehaviourScaleLabel** — configurable categories and 1–5 labels.
- **ProfileFieldDefinition** — configurable student fields: group (Personal, Parent/Guardian, Contact, Address, Academic, Other), label, type, required, order, active. Values stored per student (**storage approach decided in Phase 1/5: typed columns for core fields + structured key/value or JSON for custom fields**).

### People
- **Teacher** — staff profile linked to a User.
- **TeacherSubject** — Teacher ↔ Subject (many‑to‑many).
- **ClassTeacherAssignment** — Teacher + Section + AcademicYear (+ effective dates).
- **Student** — permanent identity across years: admission number (unique, protected), name, DOB, photo, core fields; linked to a User.
- **StudentFieldValue** — values for configurable profile fields.
- **Enrolment** — Student + Section + AcademicYear + roll number + status (Active, Promoted, Transferred, Not Promoted, Left) + dates. **The key history entity**: attendance, marks and behaviour reference the enrolment, so moving a student never rewrites the past.
- **PromotionRecord** — from‑enrolment → to‑enrolment, outcome, actor, date (could be folded into Enrolment status + audit).

### Timetable (built in Phase 6 — §5c)
- **TimetableVersion** — per AcademicYear: status Draft / Published / Superseded, version number, created/updated/published by and at, superseded at. The publish time is the version's effective‑from moment.
- **TimetableEntry** — Version + Day + Period + Section + Subject + Teacher. Uniqueness within a version: (Section, Day, Period) and (Teacher, Day, Period).

### Attendance
- **AttendanceSession** — Date + Section + Period; snapshot of Subject + Teacher from the timetable slot in force; cancelled flag + reason; marked‑by/at.
- **AttendanceRecord** — Session + Enrolment + status (`-` represented as absence of a record or explicit null, decided in Phase 7) + leave reason/description + updated‑by/at.
- **AttendanceAudit** — record, user, timestamp, old status, new status, reason, override flag.

### Exams & results
- **Exam** — AcademicYear, name, dates, order, annual weightage %, included‑in‑annual flag, rank scope, status.
- **ExamSubject** — Exam + Class (or Section) + Subject: max marks, pass marks, internal/practical components, grade scheme, normalization rule.
- **MarkSheet** — ExamSubject + Section: status Draft / Submitted / Unlocked, submitted‑by/at. Drives subject‑wise visibility.
- **MarkEntry** — MarkSheet + Enrolment: raw marks per component (null = `-` not entered; 0 = zero/absent), derived normalized value and grade (computed, possibly cached).
- **MarkAudit** — unlocks and post‑submission corrections.
- **ResultPublication** — when a full report card for an exam/section is published (if a separate step is needed).
- **BehaviourRating** — Exam + Enrolment + Category + rating 1–5; optional remark per student per exam.
- **AnnualRemark** — Enrolment: suggested remark, final remark, edited‑by/at.

### Engagement
- **Achievement** — Student (+ AcademicYear), category, title, description, date, optional file reference, created‑by.
- **Announcement** — title, body, structured audience (school / staff / class / section), academic year, author, status, publish time, expiry date.
- **StudentRequest** — Student + placement, type (Attendance Issue / Result Clarification / Profile Correction), related date/period/subject/exam/profile field, description, status, assignee, resolution, timestamps (table `requests`).
- **FileAsset** — uploaded photos/certificates: storage key, type, size, owner.

## 3. Key relationships & integrity rules

1. **Student vs Enrolment.** Student is the permanent person; Enrolment is "this student in this section in this year". All academic records hang off Enrolment → history survives promotion and transfer.
2. **Teacher's classes are derived** from timetable entries (published version), not stored on Teacher.
3. **Timetable uniqueness** (no teacher double‑booking, no section collision) is enforced by the service *and* by database unique constraints where the provider allows.
4. **Attendance snapshots context.** AttendanceSession stores the teacher/subject that applied at the time, so republishing the timetable never alters past attendance.
5. **Raw marks are immutable inputs**; normalized values and grades are derived from configuration.
6. **No hard deletes** of entities referenced by history (Class, Section, Subject, Teacher, Student, Exam, Period). Use status/active flags.
7. **Audit tables are append‑only.**
8. Primary keys: opaque IDs (UUID/ULID recommended) rather than meaningful values, so admission/roll numbers can be corrected without cascading changes.

## 4. Provider considerations (for the D‑04 decision)

| Option | Fit |
|---|---|
| PostgreSQL (self‑hosted or managed) | Strong constraints, transactions, concurrency for many teachers marking at once. Best long‑term fit for a multi‑user production system. |
| SQLite | Zero‑ops, good for a single‑server deployment and development; weaker for concurrent writes and remote hosting. |
| MySQL/MariaDB | Comparable to PostgreSQL; common on Indian shared/VPS hosting. |
| Supabase | PostgreSQL plus hosted auth/storage; adds vendor coupling — use only as "managed Postgres" to keep the data layer replaceable. |
| Firebase/Firestore | Document model fits this relational domain poorly (uniqueness, joins, transactions across collections). Not recommended. |

**No provider is selected.** Recommendation for when the user decides: a relational database (PostgreSQL preferred), accessed only through the repository layer.

---

## 5. Implemented schema (Phase 1)

Created by `apps/api/src/data/kysely/migrations/0001_foundation.ts`, `0002_school_identity.ts` (Phase 1) and `0003_authentication.ts` (Phase 2) and `0004_school_logo.ts` (Phase 3: sets `school_settings.logo_path` to the official web logo `/brand/ttlmhss-logo.webp` when unset) and `0005_school_configuration.ts` (Phase 4, §5a) and `0006_people.ts` (Phase 5, §5b). Row types: `database-schema.ts`.

### Storage conventions (portable)
| Kind | Stored as |
|---|---|
| Primary keys | `text` UUID generated by the application (`crypto.randomUUID`) |
| Timestamps (`created_at`, `updated_at`, `occurred_at`) | `text` ISO‑8601 UTC, set by the application |
| Calendar dates | `text` `YYYY-MM-DD` |
| Times of day | `text` `HH:MM` (24‑hour) |
| Controlled values | `text` + `CHECK (col IN (...))` — values mirror `@ttlmhss/shared` controlled values (a test inserts every current value) |
| Lifecycle | `status` column (`ACTIVE`/`INACTIVE`, or entity‑specific) — no boolean flags, no hard deletes of referenced rows |
| Foreign keys | always `ON DELETE RESTRICT ON UPDATE RESTRICT` — no cascades anywhere |

### Tables
| Table | Purpose | Key constraints / indexes |
|---|---|---|
| `school_settings` | School identity & contact (single row `id='default'`) | CHECK singleton; CHECK colour length 7. Seeded by 0002 with TTLMHSS / full name / `#003300`; `logo_path` NULL until the official logo is supplied |
| `academic_years` | Core time dimension | `label` unique; CHECK `start_date < end_date`; status ∈ UPCOMING/CURRENT/CLOSED; **partial unique index: at most one CURRENT** |
| `classes` | Admin‑configured classes | `name` unique; `display_order`; status |
| `sections` | Sections of a class | FK class; unique (`class_id`, `name`); status |
| `subjects` | Subject master | `name` unique; `code` unique (nullable); status |
| `periods` | Ordered day structure **per academic year**; breaks are rows with `kind='BREAK'` | FK year; CHECK kind; CHECK lessons have `period_number > 0`, breaks have none; CHECK `start_time < end_time`; unique (year, sequence); unique (year, period_number) |
| `users` | Login identity (no secrets — see `user_credentials`) | `username` unique and CHECK lowercase (case‑insensitive uniqueness on every provider); role ∈ ADMIN/TEACHER/STUDENT; status |
| `teachers` | Staff profile, 1:1 with a user | FK user (unique); `staff_code` unique; index `full_name` |
| `teacher_subjects` | Teacher → Subject (many‑to‑many) | PK (teacher, subject); index subject |
| `class_teacher_assignments` | Teacher + section + academic year | FKs; status; `assigned_on`/`ended_on`; **partial unique: one ACTIVE class teacher per section per year**; index (teacher, year) |
| `students` | Permanent student identity, 1:1 with a user | FK user (unique); `admission_number` unique; index `full_name` |
| `enrolments` | **StudentAcademicHistory**: student × section × year placement | FKs; status ∈ ACTIVE/PROMOTED/TRANSFERRED/NOT_PROMOTED/LEFT; **partial unique: one ACTIVE enrolment per student per year**; **partial unique: active roll numbers unique within section+year**; index (section, year, status); index student |
| `user_credentials` *(0003)* | Password hash + state, 1:1 with a user; **separate from `users`** so ordinary user queries can never select a hash | PK = FK `user_id` (RESTRICT); `password_hash` NOT NULL, CHECK length > 20 (a real Argon2id PHC string); `password_status` ∈ TEMPORARY/SET; `password_changed_at`; `last_login_at`. No row = no password = cannot sign in |
| `sessions` *(0003)* | Server‑side sessions | `id`; `token_hash` UNIQUE (HMAC of the cookie token — the token itself is never stored); FK user; `created_at`, `last_seen_at`, `expires_at` (CHECK `created_at < expires_at`); `revoked_at`, `revoked_reason`; `ip_address`, `user_agent` (truncated). Index (user_id, expires_at) |
| `audit_logs` | Append‑only audit trail | FK actor user (nullable); JSON text `before_json`/`after_json`; indexes (entity_type, entity_id, occurred_at), (actor, occurred_at), (occurred_at) |

Promotion and mid‑year transfer **close** the current enrolment (set status + `ended_on`) and **open** a new one; previous rows are never rewritten. This is tested.

### 5a. Phase 4 additions (`0005_school_configuration`)
| Change | Details |
|---|---|
| `school_settings` + columns | `motto`, `website`, `principal_name` (nullable; nothing invented) |
| `academic_years.working_days` | CSV of weekday codes (`MON,…`), NULL = not set |
| `subjects.display_order` | integer, default 0 |
| Case‑insensitive uniqueness | unique indexes on `lower(label)` (years), `lower(name)` (classes, subjects), (`class_id`, `lower(name)`) (sections) |
| `attendance_policy` | singleton `id='default'`; `mode` ∈ MONTHLY_CUTOFF/NO_LOCK; `cutoff_day` CHECK 1–28. **No row inserted** = unconfigured = never locks |
| `grade_schemes` | name (unique `lower(name)`), status |
| `grade_bands` | FK scheme; `label`; `min_bp` CHECK 0–10000 (hundredths of a percent); unique (scheme, min_bp), (scheme, lower(label)); optional remark. Upper bounds are derived, not stored |
| `exams` | FK academic year; name (unique per year, case‑insensitive); optional start/end (CHECK start ≤ end); `weightage_bp` 0–10000; optional FK grade scheme; `rank_scope` ∈ SECTION/CLASS; display order; status |
| `exam_subjects` | FK exam, class, subject, optional grade scheme; `theory_max`, `internal_max`, `practical_max`, `pass_marks`, `normalized_max`, `include_in_result` (0/1); CHECKs: maxima ≥ 0, total > 0, pass ≤ total; unique (exam, class, subject) |
| `behaviour_categories`, `achievement_categories` | name (unique `lower(name)`), description, display order, status |
| `behaviour_rating_labels` | PK `rating` CHECK 1–5; label; description |
| `role_permission_overrides` | PK (role, permission); `effect` ∈ GRANT/REVOKE; FK `updated_by` users. Only differences from the code defaults (permissions.md §8) |

Percentages are stored as integer **basis points** so 33.33 % is exact on every provider. All FKs remain RESTRICT. `down` drops the new tables and columns.

### 5b. Phase 5 additions (`0006_people`)
| Change | Details |
|---|---|
| `students` + columns | `gender` (CHECK MALE/FEMALE/OTHER or NULL), `father_name`, `mother_name`, `guardian_name`, `guardian_relation`, `guardian_phone`, `phone`, `email`, `emergency_phone`, `address`, `city`, `state`, `pincode`, `admission_date`, `exit_reason` (CHECK TRANSFERRED/LEFT or NULL), `exit_date` |
| `teachers` + columns | `gender`, `date_of_birth`, `address`, `designation`, `qualification`, `joining_date` |
| `enrolments` + columns | `note`, `created_by`, `closed_by` (FK users, RESTRICT) — who placed / moved the student |
| Indexes | unique `lower(admission_number)`, unique `lower(staff_code)`, `students(status)`, `teachers(status)`, `enrolments(academic_year_id, status)` |

**User ↔ Student/Teacher.** `users` holds only login identity (username, role, status); `user_credentials` the hash; `students.user_id` / `teachers.user_id` (unique, RESTRICT) link the profile. No password, role or name is copied into the profile tables or vice versa. Profile status and account status are changed together.

**Academic history** = `enrolments` (student × year × section, roll number, status ACTIVE/PROMOTED/NOT_PROMOTED/TRANSFERRED/LEFT, started_on/ended_on, who). "Current class" = the ACTIVE enrolment of the current year. Later attendance, marks and behaviour rows must reference `enrolments.id` so the year/section context is exact.

**Teacher → Subject** = `teacher_subjects` (teacher, subject) only. **Class teacher** = `class_teacher_assignments` (teacher, year, section, status, assigned_on, ended_on). **Timetable assignment** (Phase 6) is a separate table: teacher + subject + section + day + period in a timetable version (§5c). The three are deliberately not merged.

### 5c. Phase 6 additions (`0007_timetable`)

Two relationships that must never be confused:

| Relationship | Table | Meaning |
|---|---|---|
| Teacher → Subject | `teacher_subjects` (Phase 5, unchanged) | What a teacher **can** teach. No class, no period, no year. |
| Teacher + Subject + Class/Section + Day + Period | `timetable_entries` (Phase 6) | Where and when a teacher **does** teach that subject, in one timetable version of one academic year. The only place a teacher meets a class. |

| Table | Columns | Rules |
|---|---|---|
| `timetable_versions` | id, academic_year_id → academic_years, version_number, status ∈ DRAFT/PUBLISHED/SUPERSEDED, created_by / updated_by / published_by → users, published_at, superseded_at, timestamps | Unique (year, version_number). **Partial unique indexes: at most one DRAFT and one PUBLISHED version per year.** CHECK: a DRAFT has no published_at; PUBLISHED/SUPERSEDED have one. |
| `timetable_entries` | id, version_id → timetable_versions, academic_year_id → academic_years, day ∈ MON…SUN, period_id → periods, section_id → sections, subject_id → subjects, teacher_id → teachers, created_by / updated_by → users, timestamps | **Unique (version, section, day, period)** — no class collision (BR‑TT‑05). **Unique (version, teacher, day, period)** — no teacher double‑booking (BR‑TT‑04). Indexes on (teacher, subject) and (period). All FKs ON DELETE RESTRICT. |

- **Workflow:** a draft is created as a copy of the published entries (new ids) or empty; edits change only the draft; publishing marks the old PUBLISHED version SUPERSEDED and the draft PUBLISHED in one transaction. Versions are never rewritten afterwards, so the history of what was live, when and by whom, is complete. Only an unpublished draft can be deleted ("discard draft", audited with its lessons).
- **History protection:** a period, section, subject or teacher used by any version (history included) cannot be deleted (FK RESTRICT; the services explain it). A Teacher → Subject pair used by the draft or live timetable cannot be removed. Academic years with a timetable count as "in use".
- **Derived, never stored twice:** class, teacher and student timetables are queries over the PUBLISHED version (student → ACTIVE enrolment → section → entries). The Phase 7 attendance context (Date + Period + Class/Section + Subject + Teacher) is derived from the published entry for the date's weekday; attendance will snapshot teacher/subject (D‑05).

### 5d. Phase 7 additions (`0008_attendance`)

```
published timetable (version in force on the date)
  → Date + Period → Teacher + Subject + Class/Section   = attendance_sessions (one register)
  → students placed in that section on that date        = enrolments (Phase 5)
  → one status per student per period                   = attendance_records
```

| Table | Columns | Rules |
|---|---|---|
| `attendance_sessions` (register) | id, academic_year_id, date, day, period_id, section_id, **timetable_entry_id, timetable_version_id, subject_id, teacher_id** (snapshot of the lesson), revision ≥ 1, created_by / updated_by, timestamps | Unique (year, date, period, section). Indexes (section, date), (teacher, date). `revision` increases on every save (optimistic locking). |
| `attendance_records` | id, session_id, academic_year_id, date, period_id, **enrolment_id**, student_id, status ∈ `- P A L C`, leave_reason, note, created_by / updated_by, timestamps | **Unique (academic year, date, period, student)** and (session, student). CHECK: `L` needs a leave reason ∈ MEDICAL/PERSONAL/SCHOOL_ACTIVITY/OTHER; any other status has none. Index (student, date). |

- All references are ON DELETE RESTRICT: attendance is history. A student with attendance cannot be deleted; academic years with registers count as in use.
- **History:** a register keeps the lesson it was taken for. Re-publishing the timetable never changes it, and registers for a date are resolved against the version in force on that date, so moving a lesson later does not move past attendance.
- **Not marked** is stored as status `-` once a register is saved, or simply no record; both read as `-`.
- **Percentage:** P ÷ (P + A) × 100; L, C and `-` excluded; null when P + A = 0 (computed in `@ttlmhss/shared` `countAttendance`, used by every API and screen).

### 5e. Phase 8A additions (`0009_academic_calendar`)

| Table | Columns | Rules |
|---|---|---|
| `calendar_entries` | id, academic_year_id, date, status ∈ WORKING/HOLIDAY, scope ∈ SCHOOL/CLASSES/SECTIONS, reason, note, created_by / updated_by, timestamps | Index (year, date). Partial unique: one SCHOOL entry per (year, date). |
| `calendar_entry_targets` | entry_id, class_id or section_id | CHECK exactly one of class_id / section_id; unique per (entry, class) and (entry, section). |

- The weekly pattern stays in `academic_years.working_days`; entries are exceptions on top of it. Classes and sections are the Phase 4 master data (RESTRICT references), never copied.
- Overlap between class/section entries on a date is refused by the service (structural rule, BR‑CAL‑04) inside the write transaction.
- Attendance tables are untouched: calendar changes never delete or rewrite attendance (BR‑CAL‑08).

### 5f. Phase 8B additions (`0010_marks`)

```
exams (+ stage DRAFT/OPEN/CLOSED, description)
  → exam_subjects (Phase 4: exam × class × subject + marking settings)
  → mark_sheets (one per exam subject + section; authorised teacher; workflow; settings used)
  → mark_entries (one per sheet + student; raw marks in hundredths; derived values at submission)
```

| Table | Columns | Rules |
|---|---|---|
| `exams` (altered) | + `stage` (NOT NULL, default DRAFT, CHECK DRAFT/OPEN/CLOSED), `description` | Existing exams become DRAFT. |
| `mark_sheets` | id, academic_year_id, exam_id, exam_subject_id, class_id, section_id, subject_id, entry_teacher_id (nullable), status ∈ DRAFT/SUBMITTED/UNLOCKED, revision ≥ 1, calculation (JSON settings used at submission), submitted_at/by, unlocked_at/by, unlock_reason, created_by/updated_by, timestamps | **Unique (exam_subject, section)** — one sheet, so at most one authorised teacher. Composite FKs: (exam, year) → `exams(id, academic_year_id)`; (exam_subject, exam, class) → `exam_subjects(id, exam_id, class_id)`; (section, class) → `sections(id, class_id)`. CHECK: SUBMITTED needs submitted_at + calculation; UNLOCKED needs unlocked_at + reason. Indexes (exam, section), (entry_teacher). |
| `mark_entries` | id, mark_sheet_id, academic_year_id, section_id, **enrolment_id**, student_id, theory_cm / internal_cm / practical_cm (NULL = `-`), total_cm, normalized_cm, percent_bp, grade, passed, created_by/updated_by, timestamps | **Unique (sheet, student).** CHECK every mark ≥ 0, percent 0–10000, passed 0/1. Composite FKs: (sheet, year, section) → `mark_sheets`; (enrolment, year, section, student) → `enrolments` (the student's placement in that very section and year). Index (student). |

- Supporting unique indexes exist only as composite‑FK targets: `exams(id, academic_year_id)`, `exam_subjects(id, exam_id, class_id)`, `sections(id, class_id)`, `enrolments(id, academic_year_id, section_id, student_id)`.
- Marks are stored in hundredths of a mark and percentages in hundredths of a percent (exact on both databases). Component maximums are checked by the service (they live in `exam_subjects`).
- Derived values (`total_cm` … `passed`) are written at submission and cleared when a mark changes; together with `mark_sheets.calculation` they reproduce every result without today's configuration.
- All references are ON DELETE RESTRICT: marks are history. Class changes, promotion, teacher deactivation, timetable and calendar changes never touch them.

### 5g. Phase 9 additions (`0011_behaviour_achievements`)

| Table | Columns | Rules |
|---|---|---|
| `behaviour_sheets` | id, academic_year_id, exam_id, class_id, section_id, status ∈ DRAFT/SUBMITTED, revision ≥ 1, submitted_at/by, created_by/updated_by, timestamps | **Unique (exam, section).** Composite FKs: (exam, year) → `exams(id, academic_year_id)`; (section, class) → `sections(id, class_id)`. CHECK: SUBMITTED needs submitted_at. |
| `behaviour_assessments` | id, sheet_id, academic_year_id, section_id, **enrolment_id**, student_id, remark (≤ 300), created_by/updated_by, timestamps | **Unique (sheet, student).** Composite FKs to the sheet (id, year, section) and to the student's placement `enrolments(id, year, section, student)`. Index (student). |
| `behaviour_ratings` | assessment_id, category_id → `behaviour_categories`, rating (CHECK 1–5), rating_label (copied at submission/correction), updated_at | PK (assessment, category). |
| `achievements` | id, academic_year_id, student_id, **enrolment_id**, category_id → `achievement_categories`, title (1–120), description (≤ 1000), achieved_on, attachment_ref (reserved), status ∈ ACTIVE/ARCHIVED, created_by/updated_by, timestamps | Composite FK (enrolment, year, student) → `enrolments` (new unique index `enrolments(id, academic_year_id, student_id)`). Indexes (student, achieved_on), (year, status). |

- Annual‑report ready: behaviour keeps year, exam, section, student/placement, category, rating, the label that applied, remark and the submitted state; achievements keep year, student/placement, category, title, description, date and the attachment reference.
- All references are ON DELETE RESTRICT. Categories are deactivated, never deleted, so history keeps its names.

### 5h. Phase 10 additions (`0012_announcements_requests`)

| Table | Columns | Rules |
|---|---|---|
| `announcements` | id, academic_year_id, title (1–120), body (1–4000), audience ∈ SCHOOL/STAFF/CLASS/SECTION, class_id, section_id, status ∈ DRAFT/PUBLISHED/ARCHIVED, published_at/by, expires_on, created_by, updated_by, timestamps | CHECK target: SCHOOL/STAFF → no class/section; CLASS → class only; SECTION → section + its class. Composite FK (section, class) → `sections(id, class_id)`. CHECK: PUBLISHED needs published_at. Indexes (year, status, published_at), (section). |
| `requests` | id, type ∈ ATTENDANCE_ISSUE/RESULT_CLARIFICATION/PROFILE_CORRECTION, status ∈ OPEN/IN_REVIEW/RESOLVED/CLOSED, academic_year_id, student_id, **enrolment_id**, section_id, requested_by → users, requester_role (STUDENT), summary (1–200), description (1–2000), related_date, related_period_id → periods, related_subject_id → subjects, related_exam_id → exams, profile_field, assigned_to → users, resolution_note (≤ 1000), resolved_at/by, closed_at/by, revision ≥ 1, timestamps | Composite FK (enrolment, year, section, student) → `enrolments`. CHECK per type: attendance → date + period (no exam/field); result → exam + subject; profile → field only. CHECK: RESOLVED needs resolved_at, CLOSED needs closed_at. Indexes (student, created_at), (year, status), (section, status). |

- The placement at creation (enrolment + section) fixes the request's scope, so later class changes do not move it to another class teacher.
- Status and assignment history is the audit trail (`request.created`, `.review_started`, `.assigned`, `.resolved`, `.closed`, `.reopened`); announcements log `announcement.created`, `.updated`, `.retargeted`, `.published`, `.archived`, `.restored`.
- All references are ON DELETE RESTRICT. No rows are inserted.

### 5i. Phase 11 additions (`0013_annual_reports`)

| Table | Columns | Rules |
|---|---|---|
| `annual_reports` | id, academic_year_id, student_id, **enrolment_id**, section_id, status ∈ DRAFT/FINALIZED/PUBLISHED, final_remark (≤ 1000), snapshot_json, finalized_at/by, published_at/by, revision ≥ 1, created_by, updated_by, timestamps | **Unique (year, student).** Composite FK (enrolment, year, section, student) → `enrolments`. CHECK: DRAFT ⇔ no snapshot and no finalized_at; FINALIZED/PUBLISHED ⇒ snapshot, finalized_at and final remark present; PUBLISHED ⇔ published_at. Index (year, section). |

- The snapshot is the complete display‑ready report (JSON matching `AnnualReportContentSchema`), so an official report never depends on mutable configuration or records. Other reports are generated on request and not stored (D‑104).
- References are ON DELETE RESTRICT. No rows are inserted.

## 6. Mapping of the functional entity list to the schema

| Functional entity | Representation | When |
|---|---|---|
| AcademicYear, Class, Section, Subject, Period | Tables above | Phase 1 ✔ |
| Break | `periods` row with `kind='BREAK'` (one ordered day structure, so breaks sit between periods) | Phase 1 ✔ |
| SchoolConfiguration | `school_settings` (identity/contact) plus typed Phase 4 tables (`attendance_policy`, grade, exam, behaviour, achievement tables) — no generic key/value bag | Phase 1 ✔ / Phase 4 ✔ |
| User | `users` (identity) + `user_credentials` (password) + `sessions` | Phase 1 ✔ / Phase 2 ✔ |
| Role | Controlled value `users.role` (ADMIN/TEACHER/STUDENT). **CLASS_TEACHER is never stored** — it is derived per request from ACTIVE `class_teacher_assignments` in the CURRENT year | Phase 1 ✔ / Phase 2 ✔ |
| Permission | Code‑defined catalogue and default grants; Admin adjustments in `role_permission_overrides`, clipped to fixed ceilings (D‑15, permissions.md §8) | Phase 2 ✔ / Phase 4 ✔ |
| Student, Teacher, TeacherSubject, ClassTeacherAssignment | Tables above (+ Phase 5 details, §5b) | Phase 1 ✔ / Phase 5 ✔ |
| StudentAcademicHistory | `enrolments` | Phase 1 ✔ |
| Configurable student profile fields | Not built (fixed groups, D‑41); would be `student_field_definitions` + values | Open |
| AuditLog | `audit_logs` | Phase 1 ✔ |
| Timetable, TimetableAssignment | `timetable_versions` (DRAFT/PUBLISHED/SUPERSEDED, published at = effective from) + `timetable_entries` with unique (version, section, day, period) and (version, teacher, day, period) (§5c) | Phase 6 ✔ |
| AttendanceRecord, AttendanceAudit | `attendance_sessions` (date + section + period, snapshot of lesson/teacher/subject, revision) + `attendance_records` (session + enrolment + status ∈ `- P A L C`, leave reason, note); the audit trail uses `audit_logs` (`attendance.marked` / `attendance.override`) (§5d) | Phase 7 ✔ |
| Exam, ExamSubject, Mark, GradeRule, ExamWeightage | **Phase 4 ✔:** `exams` (incl. weightage), `exam_subjects` (per exam × class × subject), `grade_schemes`/`grade_bands`. **Phase 8B ✔:** `mark_sheets` (one per exam subject + section; authorised teacher; DRAFT/SUBMITTED/UNLOCKED — drives subject‑wise visibility; settings used), `mark_entries` (raw marks per component; NULL = `-`; derived values at submission); the audit trail uses `audit_logs` (entity `mark_sheet`) (§5f) | Phase 4 ✔ / 8B ✔ |
| BehaviourCategory, BehaviourRating, BehaviourAssessment | **Phase 4 ✔:** `behaviour_categories`, `behaviour_rating_labels`. **Phase 9 ✔:** `behaviour_sheets` (exam × section, DRAFT/SUBMITTED) + `behaviour_assessments` (enrolment, remark) + `behaviour_ratings` (category, 1–5 CHECK, label at submission) (§5g) | Phase 4 ✔ / 9 ✔ |
| AchievementCategory, Achievement | **Phase 4 ✔:** `achievement_categories` (configurable; the six specified categories are offered as an explicit "add suggested" choice, not seeded). **Phase 9 ✔:** `achievements` (student + year + placement, ACTIVE/ARCHIVED, attachment reference reserved) | Phase 4 ✔ / 9 ✔ |
| AnnualRemark / AnnualReport | `annual_reports` (lifecycle, final remark, frozen snapshot) (§5i) | Phase 11 ✔ |
| Announcement, StudentRequest | `announcements` (structured audience, DRAFT/PUBLISHED/ARCHIVED, expiry) and `requests` (student + placement, typed references, OPEN/IN_REVIEW/RESOLVED/CLOSED, revision); history in `audit_logs` (entities `announcement`, `request`) (§5h) | Phase 10 ✔ |

### Why feature tables are not created yet
Several of them depend on decisions that are still open — streams/electives (D‑09) for marks, timetable versioning (D‑05) for attendance, `0` vs absent (D‑07), unlock visibility (D‑11), behaviour ownership (D‑13), permissions model (D‑15). Creating them now would either lock those decisions silently or force rework migrations later. Each feature phase adds its tables in a new migration, with the relationships fixed in §1–§3 (Attendance = date + class/section + period + student + status; Marks = exam + subject + class/section + student + teacher + marks; Timetable assignment = teacher + subject + class/section + day + period).

## 7. Schema management process
- Migrations are TypeScript files in `apps/api/src/data/kysely/migrations/`, registered in order in `migrations/index.ts`, executed by Kysely's migrator (tracking table `kysely_migration`).
- Never edit a migration that has run anywhere; add a new one. Every migration has a working `down`.
- Use only portable DDL (`ddl-helpers.ts`). Controlled‑value lists are written literally inside each migration (frozen history).
- Commands: `pnpm db:migrate`, `pnpm db:status`, `pnpm db:rollback` (dev, via tsx) and `db:migrate:prod` (compiled). The API refuses to start while migrations are pending.
- The test suite migrates up, rolls everything back and re‑applies on both SQLite and PostgreSQL, so the schema is reproducible from scratch.
- **No sample data.** The only seeded row is the school identity supplied by the school. Tests create clearly synthetic fixtures in throwaway in‑memory databases.

## 8. Performance notes
Indexes exist for the expected heavy lookups: student/teacher name search, enrolments by section+year and by student, teacher's class‑teacher assignments, timetable entries by version+section/teacher slot, teacher+subject and period, audit by entity/actor/time. Attendance (the highest‑volume table) will be indexed on (section, date), (enrolment, date) and the unique session key in Phase 7. No further optimisation now.
