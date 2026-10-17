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

- **BR‑TCH‑05 (Phase 5) Teacher → Subject** is only teacher + subject (no class, no period). The subject must exist and be active; the same pair cannot be added twice; many teachers may share a subject. Removing a pair is audited. Classes and periods come from timetable assignments (Teacher + Subject + Class/Section + Day + Period, Phase 6), which check that the pair exists (BR‑TT‑02); a pair used by the draft or live timetable cannot be removed (BR‑TT‑16).
- **BR‑TCH‑06 (Phase 5) Class teacher assignment** = teacher + academic year + section. At most one ACTIVE per section per year (database‑enforced). Assigning to a section that already has a class teacher requires an explicit *replace*: the old assignment is ended (kept) and the new one starts. A teacher may hold more than one section (not restricted, D‑08). Only active teachers, active sections and non‑closed years. Deactivating a teacher ends their ACTIVE assignments.

## Academic calendar (BR‑CAL) — implemented in Phase 8A

- **BR‑CAL‑01** The year's **weekly working days** (Phase 4) are the default pattern. They are never edited to represent a single date.
- **BR‑CAL‑02** A **date entry** (Holiday or Working day, with a reason) overrides the weekly pattern for the classes it applies to: the **entire school**, **specific classes** (a class range is chosen in the configured class order and stored as explicit classes) or **specific sections**. Other classes keep the weekly pattern that day.
- **BR‑CAL‑03** Resolution, in one server‑side place (`CalendarResolver` / `resolveWorkingDay`): date outside the academic year → not working; else the one entry that applies to the class/section → its status; else the weekly pattern.
- **BR‑CAL‑04** Entries never stack: on one date at most one entry may apply to any section. The whole school overlaps every entry that day; a class overlaps itself and its own sections; sections overlap only themselves. Overlaps are refused with the existing entry named, so there is no precedence to remember. An entry must also change something (no "Working day" on a weekly working day, no "Holiday" on a weekly closed day). Closed years cannot change.
- **BR‑CAL‑05** Class‑specific special working days (e.g. a Saturday for 11–12) and class‑specific holidays (e.g. 1–10 off) are supported; different classes may resolve differently on the same date.
- **BR‑CAL‑06** A working day does not create lessons: the **published timetable** remains the only source of lessons. A section's timetable may hold lessons on the weekly working days plus the weekdays of special working dates that apply to it (e.g. Saturday lessons for 11–12 once a Saturday is a special working day for them); those lessons happen only on dates the calendar says are working.
- **BR‑CAL‑07** Non‑working dates (for that class) have no expected attendance: no register can be created, no Take attendance, no `-` counted, nothing added to percentages (P ÷ (P + A) unchanged).
- **BR‑CAL‑08** Attendance history is never deleted by later calendar changes. A register saved on a date that later becomes a holiday stays visible as **read‑only history** (no one can change it while the date is non‑working) and its records still count as recorded attendance; removing the holiday makes it editable again.
- **BR‑CAL‑09** Every create / update / delete is audited (actor, time, year, date, old and new status, applicability, reason, note). Only administrators manage the calendar (`config.manage`).

## Timetable (BR‑TT)

- **BR‑TT‑01** A timetable slot assignment = Teacher + Subject + Class + Section + Day + Period (within an academic year).
- **BR‑TT‑02** The assigned teacher must be assigned that subject (BR‑TCH‑01).
- **BR‑TT‑03** *Enter once, reflect everywhere*: the class timetable, teacher timetable, student timetable and attendance context are all **derived** from assignments. They are never stored or edited separately.
- **BR‑TT‑04** **No teacher double‑booking**: a teacher cannot have two assignments on the same day + period.
- **BR‑TT‑05** **No class collision**: a class‑section cannot have two assignments on the same day + period.
- **BR‑TT‑06** Conflicts are validated in the backend on save **and** on publish; the UI shows them but is not the enforcement point.
- **BR‑TT‑07** Workflow **DRAFT → SAVE → PUBLISH**. Edits accumulate in a draft; saving persists the draft without affecting live views; publishing makes it live atomically.
- **BR‑TT‑08** Only the published timetable drives live views and attendance.
- **BR‑TT‑09** Publishing a new version must not rewrite past attendance. Attendance records keep the teacher/subject context that applied when they were taken. *Phase 6:* every publish creates a new version; old versions become SUPERSEDED with their lessons intact, and `published_at` is the version's effective‑from moment. Attendance (Phase 7) snapshots teacher/subject (D‑05).
- **BR‑TT‑10** The primary action on a period is **Take Attendance**. Marks are never period‑based. *(The action is added with attendance in Phase 7; it is not shown before it works.)*
- **BR‑TT‑11** Periods (number, start/end time, breaks, active/inactive) are Admin‑configured. Breaks and inactive periods cannot hold assignments.
- **BR‑TT‑12 (Phase 6)** Teacher → Subject is **not** a timetable: it only says what a teacher can teach. Timetable entries (Teacher + Subject + Class/Section + Day + Period) are the only link between a teacher and a class; the same teacher/subject may appear in many classes and periods.
- **BR‑TT‑13 (Phase 6)** A lesson needs: an existing, open (not CLOSED) academic year with a draft; a working day of that year; an active teaching period of that year (not a break); an active class and section; an active subject; an active teacher who is assigned that subject. Each is checked on the server for every change (conflicts A–F) and again for the whole draft on publish.
- **BR‑TT‑14 (Phase 6)** The published timetable is never edited. Changes always go through the year's single draft (copied from the published version); publishing is explicit, validates the whole draft, and replaces the live version atomically (old version → SUPERSEDED). A failed publish changes nothing.
- **BR‑TT‑15 (Phase 6)** A batch of edits is all‑or‑nothing: changes apply in order and any refused change rejects the whole batch with the reason and its position.
- **BR‑TT‑16 (Phase 6)** History is protected: a period, section, subject or teacher used by any timetable version cannot be deleted (deactivate instead); a Teacher → Subject pair used by the draft or live timetable cannot be removed; a closed year's timetable cannot change.
- **BR‑TT‑17 (Phase 6)** If the configuration changes after a lesson was added (period deactivated, working day removed, teacher/subject deactivated, subject unassigned), the lesson is kept and shown, listed as a problem, and blocks publishing until fixed.
- **BR‑TT‑18 (Phase 6)** The timetable is the future source of the attendance context: for a date, the published entry for that weekday gives Date + Period + Class/Section + Subject + Teacher (`/timetable/lessons`).
- **BR‑TT‑19 (Phase 12C)** A class teacher may ask for a change to ONE lesson slot of their own section (add, change subject/teacher, remove) with a reason; one pending request per slot. The proposed teacher must teach the proposed subject. Nothing changes until an administrator approves; approval applies the change to the year's draft with every editor check repeated (clashes, qualification) and is refused — the request stays pending — when the slot no longer holds the lesson the request was based on. Declining needs a reason; the requester may withdraw while pending. Only administrators publish; a request never edits the published timetable.

## Attendance (BR‑ATT)

- **BR‑ATT‑01** Attendance is **period‑wise**, keyed by **Date + Class‑Section + Period + Student**. There is no single daily attendance record; any "daily" figure is derived.
- **BR‑ATT‑02** Statuses:

  | Code | Meaning | In % ? |
  |------|---------|--------|
  | `-` | Not Marked (default) | Excluded |
  | `P` | Present | Numerator & denominator |
  | `A` | Absent | Denominator |
  | `L` | Leave | Excluded |
  | `C` | Permission / conditionally excused (Phase 7; formerly "Cancelled", D‑51) | Excluded |

- **BR‑ATT‑03** **Attendance % = P ÷ (P + A) × 100.** If P + A = 0, the percentage is "not available", never 0% or 100%.
- **BR‑ATT‑04** Subject Teacher opens attendance from a published timetable period. Date, period, class, section, subject and teacher are fixed by the system, not chosen freely.
- **BR‑ATT‑05** Subject Teacher may set only `P` or `A` (or revert to `-`), only for periods they are assigned, only for the day (dates on which that period occurs), and only before the lock cutoff. *Mark All Present* sets every currently unmarked student to `P`.
- **BR‑ATT‑06** Class Teacher may view all periods of the day for their own class‑section, edit any period of their class (before cutoff), select multiple periods of one student's day at once and apply **Leave** or **C** (permission / conditionally excused).
- **BR‑ATT‑07** **Leave** (per student, per period(s)) requires a reason: Medical, Personal, School Activity, Other. **Other requires a free‑text description.**
- **BR‑ATT‑08** *(Phase 7, replaces the "Cancelled" rule)* **C** applies to one student for one or more periods. A note is optional; there is no separate reason list (D‑51). Cancelling a whole lesson for a class is not modelled.
- **BR‑ATT‑09** Precedence: `L` and `C` set by Class Teacher/Admin cannot be overwritten by a Subject Teacher. A Subject Teacher sees them as read‑only. **⚠ Open (D‑06)**
- **BR‑ATT‑10** Only students actively enrolled in the class‑section on that date appear in the register.
- **BR‑ATT‑11** **Locking** is configurable. Default model: attendance for month *M* is editable until day *N* of month *M+1* (example: September editable until 7 October, locked from 8 October). Future dates cannot be marked.
- **BR‑ATT‑12** After lock, only Admin can change attendance (**override**). An override requires a reason.
- **BR‑ATT‑13** **Every** attendance change (including the first marking and every override) writes an audit entry: user, timestamp, student, date, period, old status, new status, reason.
- **BR‑ATT‑14** Student view is a matrix: rows = dates, columns = periods, cells = `P / A / L / C / -`.
- **BR‑ATT‑15 (Phase 7) Architecture:** Published timetable (the version in force on that date) → Date + Period → Teacher + Subject + Class/Section → students placed in that section on that date → one record per student per period. A **register** (`attendance_sessions`) keeps a snapshot of the lesson it was taken for (timetable entry and version, subject, teacher), so later timetable changes never rewrite history; a record references the student's **enrolment**.
- **BR‑ATT‑16 (Phase 7) Subject‑teacher scope** comes only from the teacher's actual published timetable lesson for that date and period. Teaching a subject (Teacher → Subject) or teaching a class in another period gives no access. Request ids for teacher, subject or class are never trusted: the server resolves the lesson from date + period + section and checks it belongs to the signed‑in teacher.
- **BR‑ATT‑17 (Phase 7) Class‑teacher scope:** every period of their own section(s) in that academic year (view, edit, Leave/C across periods, student day, class totals) — never another class.
- **BR‑ATT‑18 (Phase 7)** Registers exist only for real lessons: a working day of the date's academic year, a teaching period (not a break) holding a published lesson for that section. No register for free periods, breaks, non‑working days, dates outside a year, or future dates.
- **BR‑ATT‑19 (Phase 7)** Saving a register is all‑or‑nothing (one transaction) and uses optimistic locking on the register's revision.
- **BR‑ATT‑20 (Phase 7)** A register lists students placed in the section on that date (placement dates respected; on a class‑change day the new class wins; deactivated students excluded). A student with a record who is no longer placed stays visible read‑only.
- **BR‑ATT‑21 (Phase 7)** The cutoff comes from the Phase 4 attendance policy (`MONTHLY_CUTOFF` day N, or `NO_LOCK`; no saved policy = no locking). After the cutoff, teachers and class teachers can view only; an administrator may change it only with an explicit override and a reason, audited as `attendance.override` with the reason.

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
- **BR‑MK‑06** ~~Subject Teachers can enter marks only for subjects they teach to that class‑section according to the timetable.~~ **Superseded in Phase 8B by BR‑SEC‑01/02:** mark entry is an explicit per‑sheet authorisation; the timetable is never used.

## Normalization & grades (BR‑GR)

- **BR‑GR‑01** Normalization is configured by Admin (e.g. 42/50 → 84/100). The **original raw mark is always stored**; normalized values are derived.
- **BR‑GR‑02** Grade ranges are configured (e.g. A+ 90–100, A 80–89). Ranges must be contiguous and non‑overlapping across 0–100. Grades are computed from the percentage, never typed.
- **BR‑GR‑03** Rounding rules for percentages/normalized marks are configured once and applied consistently. *(Phase 8B: half up to two decimals, applied once — BR‑MARK‑06, D‑68.)*

## Results & visibility (BR‑RS)

- **BR‑RS‑01** **Subject‑wise visibility:** a subject result becomes visible to the student **as soon as that subject is submitted**. Example: Maths submitted → Maths visible; Physics not submitted → Physics shown as "not yet available".
- **BR‑RS‑02** Visibility never waits for all subjects.
- **BR‑RS‑03** If a submitted subject is later unlocked for correction, default proposal: the student continues to see the last submitted values until the corrected sheet is resubmitted. *(Phase 8B, D‑74: the subject is hidden while unlocked and returns when resubmitted.)*
- **BR‑RS‑04** Totals, overall percentage and **rank** are shown only when all subjects required for that exam are finalized (a partial total would mislead).
- **BR‑RS‑05** Rank format `4 / 42` (position / number ranked). Scope configurable, default class‑section. Tie‑handling: standard competition ranking (1, 2, 2, 4) — adopted in Phase 8B (D‑73).
- **BR‑RS‑06** A full report card is available only once the required results are finalized/published by the workflow.

## Exams, marks & results — Phase 8B (BR‑EXAM / BR‑MARK / BR‑RESULT / BR‑SEC)

Implemented in Phase 8B on top of the Phase 4 configuration (BR‑CFG‑09/10). Arithmetic is exact (marks in hundredths, percentages in hundredths of a percent).

- **BR‑EXAM‑01** An exam belongs to exactly one academic year (database: a mark sheet's exam and year must match; its exam subject, class and section must belong together).
- **BR‑EXAM‑02** Exam subjects are configured explicitly per exam **and class** (Phase 4); no subject is added automatically. Every active section of the class takes the configured subjects; each exam subject + section has its own mark sheet.
- **BR‑EXAM‑03** Lifecycle `DRAFT` → `OPEN` (for marks) → `CLOSED`, and `CLOSED` → `OPEN` (reopen). Opening needs an active exam, a year that is not closed and at least one exam subject. Back to `DRAFT` only while no marks exist. Marks change only while the exam is `OPEN` and active and the year is not closed; `CLOSED` freezes everything (unlock included). Students see an exam only when it is active and not `DRAFT`.
- **BR‑EXAM‑04** Exam dates are independent of the academic calendar: a start/end date on which no class works is shown to the administrator as a warning; the calendar is never changed by an exam.
- **BR‑EXAM‑05** Once marks exist for an exam subject it cannot be removed, and no component maximum can drop below a mark already entered; while any of its sheets is submitted its marking settings (maximums, pass marks, "convert to", counts in result, grade scale) cannot change — unlock first.
- **BR‑MARK‑01** `-` means not entered (stored as NULL); a blank box is never turned into 0.
- **BR‑MARK‑02** `0` is a valid mark (a real zero; absence is also recorded as 0 — D‑07 unchanged). Marks may have up to two decimals (e.g. 42.5).
- **BR‑MARK‑03** Each component (theory / internal / practical — only those with a maximum above 0) is validated against its own maximum; never negative. A student is "entered" only when every component has a mark.
- **BR‑MARK‑04** Save draft stores marks without showing them to anyone outside staff with access. Submit requires every student on the roll to be fully entered, stores each student's total, normalised mark, percentage, grade and pass/fail together with the settings used (maximums, pass marks, "convert to", grade bands), records who and when, and **locks** the sheet (enforced by the API). It is one transaction: a failure finalises nothing.
- **BR‑MARK‑05** Unlock requires an administrator, or the class teacher of that section in that year holding `marks.edit`, and a reason (≥ 5 characters). The sheet becomes "unlocked for correction"; the authorised teacher, the administrator or that class teacher (`marks.edit`) corrects it and it must be submitted again.
- **BR‑MARK‑06** Raw marks are always kept. Normalised mark = total × "convert to" ÷ total maximum, rounded half up to two decimals (42/50 → 84/100). Subject percentage = raw total ÷ raw maximum × 100, rounded half up to two decimals (normalising never changes the ratio).
- **BR‑MARK‑07** Grades come from the configured scale: the subject's own scale, else the exam's; none configured → no grade. A grade applies from its minimum percentage (inclusive) up to the next grade's minimum (90 with A+ = 90–100 is A+). The grade uses the subject percentage of BR‑MARK‑06.
- **BR‑MARK‑08** Missing marks are never treated as zero: an incomplete subject has no total, grade or result and blocks submission.
- **BR‑MARK‑09** Pass = raw total ≥ the configured pass marks (Phase 4 has one pass mark per subject against its total; there are no per‑component pass marks — D‑70). A subject result is Pass, Fail or not available.
- **BR‑MARK‑10** Roster: students placed in the section on the exam's roster date (end date → start date → today, kept inside the year), in roll‑number order then name, plus anyone who already has marks on the sheet (shown as "no longer in this class", read‑only). Marks reference the enrolment, so later class changes, promotion, teacher deactivation and timetable or calendar changes never move or rewrite them.
- **BR‑MARK‑11** Every change is audited on the sheet: entries and corrections (year, exam, subject, class/section, student, component, old → new, reason when correcting), submission, resubmission, unlock (reason) and teacher assignment. Concurrent editing is refused with a reload message (sheet revision).
- **BR‑RESULT‑01** Students never see draft marks or sheets unlocked for correction — only SUBMITTED sheets, and only their own results.
- **BR‑RESULT‑02** Each subject becomes visible to the student as soon as its sheet is submitted, independently of the others.
- **BR‑RESULT‑03** The complete result exists only when every subject that counts in the result ("counts in result", Phase 4) is submitted for the student's section and the student has a mark in each. Subjects that do not count are shown but neither required nor totalled.
- **BR‑RESULT‑04** Total = Σ final marks of counting subjects; maximum = Σ their final maximums (final = normalised when "convert to" is set, else raw); percentage = total ÷ maximum × 100, half up to two decimals — never an average of subject percentages. Overall Pass only when every counting subject is passed.
- **BR‑RESULT‑05** Rank uses the exam's Phase 4 rank scope — the student's section (default) or, if configured, the whole class — of the same academic year and exam, counting only students with a complete result; standard competition ranking on the total (equal totals share a rank, 1, 2, 2, 4); shown as `rank / number ranked`.
- **BR‑RESULT‑06** A result always uses the placement the student had for that exam (where their marks are, else their placement on the roster date) — never the current class.
- **BR‑SEC‑01** Mark entry is authorised explicitly per exam subject + section: one teacher chosen by the administrator, who must be active and teach the subject (Teacher → Subject) — checked when assigned and on every request. Duplicate authorisation is impossible (one sheet per exam subject + section). Without a teacher only administrators enter the sheet.
- **BR‑SEC‑02** A timetable lesson, teaching the subject elsewhere or being the class teacher never grants mark entry. A class teacher views every sheet of their section (and may unlock / correct with `marks.edit`) but enters a fresh draft only where authorised. Requests for sheets outside a user's scope are refused the same way whether or not the sheet exists.

## Behaviour (BR‑BH)

- **BR‑BH‑01** Behaviour is recorded **per exam/result period**, not daily.
- **BR‑BH‑02** Each configured category is rated **1–5** via radio buttons. Labels are configurable (default: 1 Needs Improvement, 2 Below Expectations, 3 Satisfactory, 4 Good, 5 Excellent).
- **BR‑BH‑03** Optional teacher remark.
- **BR‑BH‑04** Class Teacher (own section, `behaviour.manage`) and Admin record behaviour — adopted in Phase 9 (D‑13, D‑81).

## Achievements (BR‑ACH)

- **BR‑ACH‑01** Only **Admin** and **Class Teacher** (for own class) can create/edit/delete achievements. Subject Teachers cannot.
- **BR‑ACH‑02** Fields: category (Academic, Sports, Cultural, Competitions, Certifications, Other), title, description, date, optional certificate/image.
- **BR‑ACH‑03** Achievements appear on the student profile and the annual report.

## Student portal, behaviour & achievements — Phase 9 (BR‑PORTAL / BR‑BEH / BR‑ACH)

- **BR‑PORTAL‑01** A student sees only their own data. Portal endpoints take no student id (the session's student is used); shared endpoints that take an id refuse any other student with the same 403 whether or not that student exists. Students never change records (all write routes need staff permissions and scope).
- **BR‑PORTAL‑02** The portal reuses existing data only: profile from the student record and enrolments (current placement = ACTIVE placement in the current year; history never flattened); timetable from the PUBLISHED version of the student's section; subjects and teachers derived from that timetable (no new teacher↔class link); attendance from Phase 7/8A (P ÷ (P + A), each lesson with subject, teacher, status); marks and results from Phase 8B (submitted subjects only, complete result and rank by the 8B rules, unlocked subjects hidden).
- **BR‑PORTAL‑03** The profile is read‑only and excludes administrative metadata (exit reason, deletability, account login data other than username/status, audit).
- **BR‑BEH‑01** Behaviour is exam‑based: ONE sheet per exam and section; one assessment per student placed in the section for that exam (same roster rule as marks, BR‑MARK‑10); one rating 1–5 per **active** configured category; optional remark ≤ 300 characters. No daily behaviour.
- **BR‑BEH‑02** Recording needs the five rating labels and at least one active category configured; the exam must be active and OPEN, the year not closed, and the class must take the exam (has exam subjects). Inactive categories are kept where already rated but are not required.
- **BR‑BEH‑03** Workflow (D‑82): **Draft → Submitted.** Drafts are visible only to staff with scope. Submit requires every on‑roll student to be rated in every active category; it stores each rating's configured label (so later label changes never rewrite a finalised assessment) and makes the sheet visible to its students.
- **BR‑BEH‑04** A submitted sheet is corrected in place: every change needs a reason (≥ 5 characters), must keep every active category rated, stores the label current at the time of the correction, and is audited (old → new rating and remark, reason). The sheet stays submitted; students see the corrected values. There is no hidden/unlocked state.
- **BR‑BEH‑05** Who: administrators (any section) and the class teacher of the section in that academic year with `behaviour.manage`. Subject teachers have no behaviour access; refusals do not reveal whether a class exists.
- **BR‑ACH‑04** An achievement belongs to a student and an academic year, and to the placement the student had on its date (date within the year; the student must be placed then). Category must be an ACTIVE configured category (an existing inactive one may stay on edit). Title ≤ 120, description ≤ 1000 characters.
- **BR‑ACH‑05** Administrators manage any achievement; class teachers those of students placed in their own section in that year (`achievements.manage`). A class teacher cannot tell whether a student outside their class exists.
- **BR‑ACH‑06** Archive (administrator or class teacher) hides an achievement from the student and keeps it; restore brings it back. Archived achievements cannot be edited. Only administrators may delete, and only an archived achievement; deletion is audited with the full record.
- **BR‑ACH‑07** Attachments: a reference column exists for a later certificate/image upload; nothing can be uploaded yet (D‑88).

## Annual report (BR‑AR)

- **BR‑AR‑01** Aggregates academic performance using **configured exam weightage**, exam results, attendance (BR‑ATT‑03), behaviour, achievements and remarks.
- **BR‑AR‑02** The system may **suggest** a remark from marks, attendance, behaviour and achievements. The Class Teacher writes/edits the **final** remark; suggestions are never published without a human save.
- **BR‑AR‑03 Annual percentage (Phase 11, D‑102)** = Σ (exam percentage × exam weightage) ÷ 100, half‑up to two decimals. Exam percentage = the Phase 8B result (Σ final marks ÷ Σ final maximums); weightage = the Phase 4 configuration of the year's ACTIVE exams. It is calculated only when the weightages total exactly 100 % and every exam with weightage > 0 has a complete result for the student; otherwise it is "Not available" and the report cannot be finalized. Exams with weightage 0 are shown but never enter the figure. No annual grade, pass/fail or rank is produced (no existing rule defines them).
- **BR‑AR‑04 Lifecycle (D‑103):** one annual report per student and year. DRAFT — computed live, staff only; FINALIZED — requires the final remark and no problems, freezes the full content; PUBLISHED — the student can see and download it. Class teachers (own section, `reports.generate`) and administrators prepare, write the remark and finalize; only administrators publish, unpublish and reopen (FINALIZED → DRAFT with a reason, discarding the frozen content). Every step is audited.
- **BR‑AR‑05 Snapshot (D‑104):** finalization stores the complete display‑ready content (results with the labels/grades/maximums that applied, weightages, attendance counts, behaviour with labels, achievements with category names, student/class names, the final remark). A finalized or published report never changes when marks, attendance, configuration or placement change later.
- **BR‑AR‑06** The system suggestion (D‑106) is a factual sentence (annual %, attendance %, achievement and assessment counts); it is shown only on drafts, labelled as a suggestion, and never printed on the official report.

## Reports (BR‑REP) — Phase 11

- **BR‑REP‑01 One source of truth.** Reports are composed from the existing services (Phase 8B results/mark sheets, Phase 7/8A attendance, Phase 9 behaviour/achievements) with the caller's identity; no report recalculates marks, grades, ranks, completeness or attendance percentages. The preview and the PDF come from the same report document.
- **BR‑REP‑02 Report cards:** a student sees only their own submitted subjects (Phase 8B); an official PDF exists only for a complete result — otherwise the request is refused with how many subjects are published. Unlocked subjects are unavailable again, so the card is too.
- **BR‑REP‑03 Mark sheets** follow Phase 8B sheet authorisation (entry teacher, own‑section class teacher, administrators); a non‑submitted sheet prints a "Not final" banner.
- **BR‑REP‑04 Attendance reports** use the attendance views (P ÷ (P + A); L, C and not‑marked excluded; academic calendar; registers kept on later holidays count as history, as in Phase 8A). The class Excel file is a real `.xlsx` with one row per date + period + student.
- **BR‑REP‑05 School identity on reports:** only configured values (name, short name, address, phone, email, website, motto, principal's name) and the official logo; nothing is invented. Signature lines carry role labels only (D‑107).
- **BR‑REP‑06 File names:** `SHORTNAME_YEAR_Kind_identifiers.pdf|xlsx`, every part reduced to letters, digits, "-" and "_" (admission number, exam name or class; never personal names).

## Students, accounts, promotion (BR‑ST)

- **BR‑ST‑01** One student = one account, created automatically on admission. Teacher accounts likewise on creation.
- **BR‑ST‑02** New accounts get temporary credentials and must change password at first login.
- **BR‑ST‑03** **Student isolation:** a student can access only their own records. Every student‑facing query is scoped by the authenticated student's ID **in the backend**; IDs from the client are never trusted for this.
- **BR‑ST‑04** Students never edit academic records. Profile corrections go through a Profile Correction request.
- **BR‑ST‑05** Promotion outcomes: **Promoted, Transferred, Not Promoted, Left**. Supports whole class‑section and individual promotion. Promotion creates new enrolments (BR‑AY‑03).
- **BR‑ST‑06** Transferred/Left students' accounts are deactivated (default proposal) but their records remain.
- **BR‑ST‑07** Protected system fields (IDs, admission number, account linkage, enrolment status) are controlled by the application, not by configurable field definitions.
- **BR‑ST‑08 (Phase 5) Identifiers.** The internal `id` (UUID) is the permanent database identity. The **admission number** is the school's permanent student number: unique ignoring case, set at admission and not editable. The **roll number** belongs to an enrolment (year + section), is unique among ACTIVE placements of that section, and may change on every move/promotion. Teachers: the **staff ID** is unique ignoring case and not editable.
- **BR‑ST‑09 Admission** creates, in one transaction: the student record, a STUDENT login account (username = the given one, or the admission number lower‑cased with other characters turned into "-"), a TEMPORARY credential (Argon2id hash only) and the first enrolment in a current/upcoming year and an active section; it is audited. The plaintext password created then is discarded — the administrator deliberately issues one to hand over (BR‑ST‑14).
- **BR‑ST‑10 Placement & history.** A student has at most one ACTIVE enrolment per year (database‑enforced). The current class/section/roll is the ACTIVE enrolment of the current year. Enrolments are never edited or deleted after the fact (except deleting a record created by mistake, BR‑ST‑13); each records who opened and closed it.
- **BR‑ST‑11 Class change (transfer within the school)**, same academic year: the current enrolment is closed with status TRANSFERRED and an end date; a new ACTIVE enrolment starts on the same date in the target section. Target must be an active section, different from the current one; the date must be inside the year and not before the current placement started; the roll number must be free.
- **BR‑ST‑12 Promotion** (whole section, selected or single students; individual outcomes): PROMOTED / NOT_PROMOTED close the source enrolment (end = source year's last day) and open one in the target year (start = its first day) in the chosen active section; the target year must start after the source year and not be closed; a student already placed in the target year is refused. TRANSFERRED / LEFT close the enrolment (end = today, or the source year's last day if today is outside it), set the student INACTIVE with the exit reason and date, disable the account and end its sessions; no target year is needed. The whole request is one transaction: any failure changes nobody.
- **BR‑ST‑13 Deactivation and deletion.** Deactivating a student or teacher keeps the record, history and account; the account is disabled and its sessions end; reactivating restores both. A record may be **deleted** only if it was created by mistake and never used: student — at most its admission placement, account never signed in and never acted; teacher — never a class teacher, account never used. Otherwise the API refuses and deactivation is the answer. Database foreign keys (RESTRICT) protect future attendance/marks rows the same way.
- **BR‑ST‑14 Temporary passwords** are issued on demand (`users.reset_password`): a new random password replaces the old, all sessions end, the person must change it at first sign‑in. It is returned once (`Cache-Control: no-store`), shown once in the UI, never stored or logged in plain text, never in the audit log.

## Requests & announcements (BR‑RQ)

- **BR‑RQ‑01** Request types: Attendance Issue, Result Clarification, Profile Correction. Only students create requests, about themselves, while placed in a class in the current year. No threaded chat.
- **BR‑RQ‑02 Routing (Phase 10, D‑95; closes D‑14).** Attendance issues and result clarifications are assigned to the class teacher of the section the question is about — the student's placement on the lesson date, or the placement in which the exam was written (BR‑RESULT‑06); for a student who never changed class this is the current section (Phase 12B) — and are also visible to administrators; profile corrections go to administrators only (unassigned = the office queue). Subject teachers see no requests. Administrators may assign a request to another administrator or to the section's class teacher.
- **BR‑RQ‑03 What a request refers to** is checked by the server from the student's own data: an attendance issue names a date in the year, not in the future, and a period in which the student actually had a lesson (the subject is taken from that lesson); a result clarification names an exam whose results the student may see (Phase 8B) and one of its subjects for the student; a profile correction names a detail category. Description 10–2000 characters. At most 10 requests may be Open or In review per student (D‑97).
- **BR‑RQ‑04 Lifecycle (D‑94):** Open → In review (the reviewer becomes the assignee if none) → Resolved (resolution note ≥ 5 characters, visible to the student) → Closed. An unresolved request may be closed with a note (it becomes the resolution, e.g. duplicate). Resolved/Closed → Open again with a reason (the earlier resolution stays in the history). Every change checks the request's revision.
- **BR‑RQ‑05 No back door.** Handling a request changes only the request. Attendance, marks and profile data are corrected through their own pages and rules (locks, unlock reasons, audits); the request page links there.
- **BR‑RQ‑06 Visibility.** A student sees only their own requests (status, resolution, dates), never another student's — refused like a missing id. Reviewers see requests in scope with the history from the audit trail.
- **BR‑AN‑01 Announcements (Phase 10, D‑96).** Audience is structured: whole school (everyone), teachers and staff (teachers and administrators), a class (students placed in any of its sections + their class teachers), a section (its students + its class teacher). Administrators see every audience. Subject teachers do not see class/section announcements.
- **BR‑AN‑02 Who writes:** administrators — any audience; class teachers with `announcements.manage` — only their own section (this academic year), never another section, a whole class, staff or the whole school; subject teachers and students — never.
- **BR‑AN‑03 Lifecycle:** Draft (managers only) → Published (its audience, from the publish time) → Archived (hidden, kept). Restore returns it to Published (if it had been published) or Draft. No deletion. An optional expiry date (inclusive, not in the past) hides a published announcement from its audience afterwards; managers still see it marked "Expired". Edits of archived announcements are refused; announcements of a closed year are read‑only.
- **BR‑AN‑04** Every create, edit, re‑target, publish, archive and restore is audited (entity `announcement`, before/after).
- **BR‑DASH‑01 Dashboards consume, never compute (D‑91).** Every number comes from the existing service used by the page it links to; no dashboard‑specific definitions. Lessons and "registers to take" follow the published timetable and the academic calendar (no lessons on a holiday). A mark sheet is "Not started" while no student's marks are entered (D‑92).

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

## School configuration (BR‑CFG) — implemented in Phase 4

- **BR‑CFG‑01** Configuration is data entered by an administrator. Nothing is pre‑filled with invented school values; "suggested" categories/labels from the specification are added only when the administrator chooses them.
- **BR‑CFG‑02** Names are unique ignoring case and surrounding spaces: academic‑year labels, class names, section names within a class, subject names and codes, grade‑scale names, exam names within a year, behaviour and achievement category names.
- **BR‑CFG‑03 Academic years** must not overlap. Exactly one is current; making another year current is an explicit, confirmed action — the previous current year becomes CLOSED (if it started earlier) or UPCOMING. A year can be deleted only if it is not current and nothing belongs to it (periods, exams, enrolments, class‑teacher assignments); otherwise it stays. Changing a year's dates may not leave an exam outside them.
- **BR‑CFG‑04 Classes, sections, subjects, categories** are deactivated, never deleted (BR‑CS‑02). Inactive subjects/classes cannot be newly added to an exam.
- **BR‑CFG‑05 Periods & breaks** belong to an academic year (D‑29). Lesson periods have a number, breaks do not. Active slots may touch but never overlap; period numbers are unique in the year and must follow the order of the day (P1 before P2). The display order is derived from start times. Copying a day structure is allowed only into a year with none.
- **BR‑CFG‑06 Working days** are stored per academic year (at least one).
- **BR‑CFG‑07 Attendance locking** (BR‑ATT‑11): mode `MONTHLY_CUTOFF` with a cutoff day 1–28 (exists in every month) or `NO_LOCK`. Month *M* is editable up to and including the cutoff day of month *M+1*; locked from the next day (`attendanceLockDate`, shared). Until a policy is saved, attendance never locks. Overrides (BR‑ATT‑12) arrive with Phase 7.
- **BR‑CFG‑08 Grade scales** (BR‑GR‑02) store only each grade's **minimum** percentage (two decimals at most); the upper bound is the next grade's minimum (top grade: 100). Overlaps and gaps are therefore impossible. A scale needs ≥ 2 grades, distinct names and minimums, and a grade starting at 0%. Scales used by an exam cannot be deleted.
- **BR‑CFG‑09 Exam weightage** (BR‑EX‑03): each exam has a weightage 0–100% (two decimals). The total of ACTIVE exams in a year may never exceed 100%; the screen shows when it reaches exactly 100% ("complete"). Phase 8 must refuse annual results unless it is complete. Exam dates must lie within the year. Rank scope per exam: SECTION (default) or CLASS.
- **BR‑CFG‑10 Exam subjects** are set per exam **and class**: theory max (+ optional internal and practical), pass marks ≤ total, total > 0, optional "convert to" maximum for normalization (BR‑GR‑01, original marks kept), whether the subject counts in the result, optional grade scale overriding the exam's. An exam that has subjects cannot be deleted (deactivate instead).
- **BR‑CFG‑11 Behaviour ratings** use exactly five labels, one per rating 1–5 (BR‑BH‑02); saved together.
- **BR‑CFG‑12** Every configuration change is audited in the same transaction (`config.*` actions with before/after).
