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

### Timetable
- **TimetableVersion** — per AcademicYear (optionally per Section): status Draft / Published / Superseded, effective‑from date, published by/at.
- **TimetableSlot** — Version + Section + Day + Period + Subject + Teacher. Uniqueness within a published version: (Section, Day, Period) and (Teacher, Day, Period).

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
- **Announcement** — title, body, audience (all / role / section), author, publish/expiry dates.
- **StudentRequest** — Student, type (Attendance Issue / Result Clarification / Profile Correction), message, status, response, handled‑by/at.
- **FileAsset** — uploaded photos/certificates: storage key, type, size, owner.

## 3. Key relationships & integrity rules

1. **Student vs Enrolment.** Student is the permanent person; Enrolment is "this student in this section in this year". All academic records hang off Enrolment → history survives promotion and transfer.
2. **Teacher's classes are derived** from TimetableSlot, not stored on Teacher.
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

Created by `apps/api/src/data/kysely/migrations/0001_foundation.ts`, `0002_school_identity.ts` (Phase 1) and `0003_authentication.ts` (Phase 2) and `0004_school_logo.ts` (Phase 3: sets `school_settings.logo_path` to the official web logo `/brand/ttlmhss-logo.webp` when unset). Row types: `database-schema.ts`.

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

## 6. Mapping of the functional entity list to the schema

| Functional entity | Representation | When |
|---|---|---|
| AcademicYear, Class, Section, Subject, Period | Tables above | Phase 1 ✔ |
| Break | `periods` row with `kind='BREAK'` (one ordered day structure, so breaks sit between periods) | Phase 1 ✔ |
| SchoolConfiguration | `school_settings` (identity/contact). Other settings (attendance cutoff, grade rules, behaviour labels …) get **typed tables in their own phase**, not a generic key/value bag | Phase 1 ✔ / Phase 4+ |
| User | `users` (identity) + `user_credentials` (password) + `sessions` | Phase 1 ✔ / Phase 2 ✔ |
| Role | Controlled value `users.role` (ADMIN/TEACHER/STUDENT). **CLASS_TEACHER is never stored** — it is derived per request from ACTIVE `class_teacher_assignments` in the CURRENT year | Phase 1 ✔ / Phase 2 ✔ |
| Permission | **No tables.** Permissions are a code‑defined catalogue with per‑role grants (D‑15, docs/permissions.md). Tables would only be added if Admin‑editable permissions are requested | Phase 2 ✔ |
| Student, Teacher, TeacherSubject, ClassTeacherAssignment | Tables above | Phase 1 ✔ |
| StudentAcademicHistory | `enrolments` | Phase 1 ✔ |
| Configurable student profile fields | `student_field_definitions` + values | Phase 4/5 |
| AuditLog | `audit_logs` | Phase 1 ✔ |
| Timetable, TimetableAssignment | `timetable_versions` (DRAFT/PUBLISHED/SUPERSEDED, effective‑from) + `timetable_slots` with unique (version, section, day, period) and (version, teacher, day, period) | Phase 6 |
| AttendanceRecord, AttendanceAudit | `attendance_sessions` (date + section + period, snapshot of teacher/subject, cancelled flag) + `attendance_records` (session + enrolment + status ∈ `- P A L C`, leave reason) + `attendance_audit` | Phase 7 |
| Exam, ExamSubject, Mark, GradeRule, ExamWeightage | `exams` (incl. weightage column — weightage is a property of an exam, not a separate entity unless Phase 8 needs per‑class weightage), `exam_subjects`, `mark_sheets` (DRAFT/SUBMITTED/UNLOCKED — drives subject‑wise visibility), `mark_entries` (raw marks; NULL = `-`), `grade_schemes`/`grade_bands`, `mark_audit` | Phase 8 |
| BehaviourCategory, BehaviourRating, BehaviourAssessment | `behaviour_categories`, `behaviour_scale_labels`, `behaviour_assessments` (enrolment × exam, remark) + `behaviour_ratings` (category, 1–5 CHECK) | Phase 9 |
| AchievementCategory, Achievement | `achievement_categories` (configurable, seeded with the six specified categories) + `achievements` | Phase 9 |
| Announcement, StudentRequest | `announcements`, `student_requests` | Phase 10 |

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
Indexes exist for the expected heavy lookups: student/teacher name search, enrolments by section+year and by student, teacher's class‑teacher assignments, audit by entity/actor/time. Attendance (the highest‑volume table) will be indexed on (section, date), (enrolment, date) and the unique session key in Phase 7. No further optimisation now.
