# Database Design — TTLMHSS (High‑Level Conceptual Model)

**Conceptual only.** No schema, column types, indexes or provider choice are fixed here. The physical schema is designed in Phase 1 and extended per phase. The model is relational in shape because the domain is highly relational, but it is expressible in any mainstream relational database.

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
