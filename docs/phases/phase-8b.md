# Phase 8B — Exams, Marks & Results

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting the next instruction (Phase 9 not started).

## Objective
The whole exams → marks → results workflow:
1. Administrators configure exams, open them and authorise who enters each subject's marks.
2. Teachers enter, save and submit marks; submission locks the sheet.
3. Authorised people unlock with a reason and resubmit.
4. Students see each subject as soon as it is finalised, and the complete result (total, percentage, rank) once every counting subject is finalised.

## Starting state
- **Phase 8A** was committed (`b72c804`, 335 tests, 44 e2e).
- **Phase 4** already had:
  - `exams` (per year, with weightage, rank scope SECTION/CLASS and a grade scale);
  - `exam_subjects` (per exam × class × subject: theory, internal and practical maximums, pass marks, "convert to", counts in result, grade‑scale override);
  - grade scales (minimum percentage per grade);
  - behaviour categories and 1–5 labels.
- The `exams.*`, `marks.*` and `results.view` permission keys existed but were unused.
- `MarkSheetStatus` (DRAFT/SUBMITTED/UNLOCKED) was defined in the shared package.

## What was implemented

**Exam lifecycle** (BR‑EXAM‑03, D‑64)
- `exams.stage` follows **Draft → Open for marks → Closed**, with reopen and a guarded "back to draft". It is separate from Active/Inactive.
- Opening needs an active exam, a year that is not closed and at least one subject. Only open exams take marks; Closed freezes everything.
- Exams also gained an optional description.
- Exam dates stay independent of the academic calendar. A start or end date on which no class works shows a warning only (BR‑EXAM‑04, D‑77).

**Exam subject / class configuration**
- The Phase 4 configuration stays the master; no competing system was added.
- Each exam subject applies to every active section of its class, and each exam subject + section has one mark sheet (D‑65).
- The configuration is now protected once marks exist (BR‑EXAM‑05):
  - a subject with marks cannot be removed;
  - a component maximum cannot drop below a mark already entered;
  - the settings of a submitted subject cannot change until it is unlocked.
- The "theory 100" prefill in the subject editor was removed (no hard‑coded 100).

**Teacher authorisation** (BR‑SEC‑01/02, D‑66)
- The administrator chooses **one** teacher per exam subject + section, from active teachers who teach that subject (Teacher → Subject).
- The choice is stored on the mark sheet. Assigning the same teacher twice is refused, and there is only one sheet, so authorisations cannot be duplicated.
- Access is re‑checked on every request: removing the subject from the teacher or deactivating the teacher removes access.
- The timetable is never used. A teacher who teaches Maths to X‑B in the published timetable gets nothing there unless authorised.
- Class teachers can view every sheet of their section. With `marks.edit` they can unlock a submitted sheet and correct an unlocked one, but they never enter a fresh draft for another teacher.
- A sheet without a teacher is entered by administrators only.

**Mark entry workflow** — Marks → exam → sheet (subject — class section) → table:
- columns: roll, name with admission number, one box per configured component with its maximum, total, converted mark, grade and Pass/Fail;
- live preview using the shared calculation, and a "38 / 42 students entered" count;
- Tab moves across the row, Enter moves down;
- on phones, one card per student;
- Save draft, Submit (confirmation), Unlock (reason dialog) and a history panel.
- A blank box stays `-` and `0` is a real zero. Marks accept up to two decimals, are checked against each component's maximum and are never negative (BR‑MARK‑01…03, D‑67).

**Roster** (BR‑MARK‑10, D‑75)
- The sheet lists the students placed in the section on the exam's end date (else its start date, else today, clamped to the year), in roll order then name.
- Students who left before that date or joined after it are not listed.
- Students who already hold marks on the sheet stay on it, shown read‑only.

**Draft, submission and locking** (BR‑MARK‑04, D‑72)
- Drafts are transactional and revision‑checked.
- Submit requires every on‑roll student to have every component. It then:
  - stores each student's total, normalised mark, percentage, grade and pass/fail;
  - stores the settings used (`mark_sheets.calculation`: maximums, pass marks, convert‑to, grade bands);
  - records who submitted it and when, then locks the sheet.
- Submission is one transaction.
- The lock is enforced by the API.

**Unlock** (BR‑MARK‑05, D‑74)
- Only an administrator, or the class teacher of that section in that year with `marks.edit`, can unlock, and must give a reason of at least 5 characters.
- The sheet becomes "Unlocked for correction" and must be resubmitted.
- While unlocked, the subject is hidden from students.

**Normalisation** (BR‑MARK‑06, D‑68)
- Raw marks are kept.
- Normalised mark = total × convert‑to ÷ total maximum, for any maximum (42/50 → 84/100; 37/70 → 52.86/100).
- Arithmetic uses exact integers (hundredths), rounded half up to two decimals, once.

**Grades** (BR‑MARK‑07, D‑69)
- The scale is the subject's own, else the exam's.
- The grade is taken from the subject percentage (raw total ÷ raw maximum). A grade runs from its minimum (inclusive) up to the next grade's minimum: 90 → A+, 89.99 → A.

**Pass/fail** (BR‑MARK‑09, D‑70)
- Pass = raw total ≥ the configured pass marks. Phase 4 has no per‑component pass marks, so none are applied.
- A subject's result is Pass, Fail or not available; a missing mark is never a Fail.

**Visibility** (BR‑RESULT‑01/02)
- Students see only subjects whose sheet is SUBMITTED, and only their own results.
- Drafts and sheets unlocked for correction never leave the API for students.

**Complete result** (BR‑RESULT‑03/04, D‑71)
- A complete result needs every "counts in result" subject submitted for the student's section.
- Total = Σ final marks ÷ Σ final maximums × 100, where "final" is the normalised mark when convert‑to is set. Subject percentages are never averaged.
- Overall Pass requires every counting subject to be passed.
- Non‑counting subjects are shown but not totalled.

**Rank** (BR‑RESULT‑05, D‑73)
- Standard competition ranking (1, 2, 2, 4) on the total.
- Only students with a complete result are ranked, within the exam's Phase 4 rank scope: the section by default, or the whole class if configured. The scope always means the same academic year and exam.
- Shown as `rank / number ranked`.

**History** (BR‑RESULT‑06, D‑76)
- Results use the placement where the student's marks are, never the current class. A transfer after the exam leaves the result in the old section with the same rank.
- A teacher's deactivation keeps their submissions, and the administrator can finish their drafts.

**Pages**
- **Marks** (teachers, administrators): exams with the sheets the user may open, and the mark sheet.
- **Results**:
  - students: *My results* (year, exam, details, complete‑result tiles, subject table — a list on phones);
  - class teachers and administrators: class results (students × subjects, total, %, result, rank).
- School setup → **Exams**:
  - the exam list shows the marks stage, and exams get a description field;
  - the exam page gains **Marks and results** (stage buttons with confirmations, calendar warnings, sheet counts);
  - it also gains **Mark entry** (subject × section: maximum, pass marks, teacher select limited to teachers of the subject, status, entered count).

**Behaviour: deferred** (D‑78)
- Phase 4 has categories and 1–5 labels, but not:
  - who records ratings (D‑13 is still only proposed);
  - when ratings become visible to students;
  - whether they lock like marks.
- Building it would mean inventing those rules, and Phase 9 is "Student portal, behaviour and achievements", so nothing was built.

## Database — migration `0010_marks` (database‑design.md §5f)
- `exams` gains `stage` (default DRAFT, CHECK) and `description`.
- `mark_sheets` has a unique key on (exam subject, section) and composite foreign keys tying the exam to its year, the exam subject to that exam and class, and the section to that class. CHECK constraints cover the submitted and unlocked states.
- `mark_entries` has a unique key on (sheet, student) and CHECK constraints (marks ≥ 0, percentage 0–10000). Composite foreign keys tie each entry to its sheet's year and section, and to an enrolment of that student in that section and year.
- Every reference is ON DELETE RESTRICT.
- The migration applies, rolls back and re‑applies on SQLite and PostgreSQL. It has been applied to the development database.

## Permissions (D‑79)
No new keys.

| Key | Used for |
|---|---|
| `config.manage` | Phase 4 exam settings |
| `exams.manage` (admin) | Stage and mark‑entry teachers |
| `marks.view` | Opening sheets, narrowed per sheet |
| `marks.enter`, `marks.submit` | The authorised teacher |
| `marks.edit` (class‑teacher ceiling) | Unlocking and correcting their own section |
| `results.view` | Students: own; class teachers: own section; admins: all |

- Plain teachers see grades and pass/fail on their sheets; the Results menu is for students, class teachers and administrators.
- A refusal is the same 403 whether or not the sheet or student exists.

## Audit
All events are recorded on entity `mark_sheet`.
- `marks.entered` / `marks.corrected` record:
  - year, exam, subject, class/section and student (admission and roll number, enrolment);
  - per component: old → new;
  - the unlock reason, for corrections.
- `marks.submitted` / `marks.resubmitted` record the student and pass counts and the settings used.
- `marks.unlocked` records the reason and the previous submitter.
- `marks.teacher_assigned` records the previous and new teacher.
- `exam.stage_changed` is recorded on the exam.
- The sheet's history panel reads these entries.
- The audit redactor no longer masks `passMarks`/`passed` (it matched "pass"); passwords, secrets, tokens and hashes are still masked (D‑80).

## Concurrency
- Each sheet has a revision. Save, submit and unlock claim it with a conditional update (`WHERE revision = expected`). A stale request gets 409 "Reload the sheet…", and the page offers a reload.
- Each operation is one transaction: a failure part‑way through Submit finalises nothing (tested by injecting a storage failure).

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (lint, format, typecheck, unit, integration, component) | clean — **371 tests in 27 files** (Phase 8A: 335) |
| Shared `marks.test.ts` (12) | half‑up rounding; components with max > 0; incomplete ≠ 0; Y/Z normalisation (42/50 → 84, 37/70 → 52.86, 33.5/40 → 41.88/50); components added once (65 + 18 = 83/100); AA grade boundaries (90 → A+, 89.99 → A); AB pass on the raw total incl. exact pass mark and 0; AG 247/280 = 88.21 % (not the 88.33 average); competition rank 1, 2, 2, 4; Q input validation (negative, 3 decimals, text); V unlock reason |
| API `marks.test.ts` (8 × SQLite and PostgreSQL + 1) | see the breakdown below |
| Web `marks.test.tsx` (7) | blank stays "-", 0 counts, a too‑high mark is caught before sending, only changes are sent; Submit confirmation, locked read‑only sheet, unlock reason required; stale‑save reload; student partial result ("Not yet available", no total); complete result with total, %, Pass and `4 / 42`; plain teachers get no Results page; administrator assigns the mark‑entry teacher and opens the exam |
| Mutation checks | opening sheet access to everyone fails tests J/K and V/W; making unlocked sheets visible fails V/W (drafts stay hidden by a second, independent check — no derived values before submission) |
| `pnpm --filter @ttlmhss/web test:e2e` | **50/50** (6 new) — see the breakdown below |
| `pnpm build` | builds (web JS 695 KB / 195 KB gzip) |
| Migrations | `0010` applies, rolls back and re‑applies on both providers; applied to the development database |
| Manual | screenshots of the sheet at 1440/820/390 px, student results at 1440/820/390, class results and the admin exam page reviewed; the phone subject table was replaced by a list after review |

**API tests (`marks.test.ts`), by area:**
- A–I, AP: create and edit an exam; per‑subject maximums, components, pass marks and convert‑to; the exam‑date calendar warning (calendar untouched); the matrix; authorisation; a duplicate, a non‑subject teacher or a section of another class refused; stage rules; 403 for teachers; 401 signed out.
- J, K, AL, BR‑SEC‑02: only authorised sheets are listed; a timetabled class gives no access, with the same 403 as a missing sheet; tampered ids and students of another section refused; class teacher view‑only; removing Teacher → Subject revokes access.
- L–X: roll‑ordered roster excluding a leaver and a later joiner; draft with 0 and `-`; above the maximum, negative and wrong‑component marks refused; incomplete submit refused; submit stores the results and settings; lock enforced; unlock refused to teachers; audit content.
- V, W: reason required; class‑teacher unlock; subject hidden while unlocked; correction audited with the reason; resubmit; the full history order; other class refused; administrator unlock.
- Y–AK: draft invisible (even its digits); submitted subjects visible; no complete result until all counting subjects; normalised English with the raw mark kept; components; totals 247/300 = 82.33 %; non‑counting Drawing; a fail making the overall result FAIL; competition rank 1, 3, 1 within X‑A and a separate X‑B population; a late joiner not ranked; a transfer keeps the X‑A result; no access to other students (same 403 as missing) or to class results.
- AM: a deactivated teacher's submission is kept, and the administrator finishes the inactive teacher's draft.
- AN: stale save and submit refused.
- Configuration guards: removing a subject with marks or lowering a maximum below a mark refused; changing a submitted subject refused; grade‑scale edits don't rewrite submitted grades; closing an exam freezes it.
- AO: an injected storage failure during Submit leaves the sheet DRAFT with nothing finalised and no submit audit.

**New browser tests (`marks.spec.ts`):**
- Administrator: creates the exam in the UI, configures Maths and English (50 → 100), assigns the Maths teacher (English offers nobody) and opens the exam.
- Teacher: Marks → sheet → 101 rejected → 72 → Save draft ("Draft", students cannot see drafts) → Submit → locked (inputs disabled, no unlock button).
- Unauthorised: the English sheet and the X‑B Maths sheet are refused in the page, and the API returns 403.
- Student: Maths visible, the English draft hidden, then after submission the complete result 155 / 200, 77.5 %, rank 1 / 1, "41.5/50 converted to 83/100"; no overflow at 390 px.
- Class teacher: unlocks (reason required), corrects 72 → 75, resubmits; the history shows the correction, the unlock with its reason and the original entry; class results show 158 / 200.
- Tablet and phone: table at 820 px, cards at 390 px, no page overflow.

All Phase 1–8A flows pass. Two existing specs were adjusted:
- the navigation lists now include Marks/Results;
- the admin exam link is now "Set up …".
Two waits were added for navigation races, one of them in the timetable spec, which had flaked once.

## Out‑of‑scope check
Nothing outside exams, marks and results was built:
- no behaviour recording, achievements, report cards, PDFs, annual results or printable sheets;
- no dashboards, notifications, requests, parent portal, analytics or Excel;
- no changes to attendance, timetable or calendar behaviour.

Changes outside the marks modules:
- the Phase 4 exam settings guards and the stage/description fields;
- the audit redaction fix;
- the reusable leave‑page guard message;
- navigation entries;
- e2e adjustments.

## Known limitations
- **Electives / streams (D‑09):** every student of a section is assessed in every subject configured for the class. Subjects that only some students take cannot be modelled yet.
- **Section applicability (D‑65):** an exam subject cannot be excluded for one section of a class.
- **One mark‑entry teacher per sheet (D‑66):** co‑teaching needs the administrator to switch the teacher or enter the marks.
- **No per‑component pass marks (D‑70)** and no overall exam grade (D‑69).
- **Absent vs zero (D‑07):** absence is recorded as 0 only; no separate flag.
- **Annual (weighted) results** across exams are not computed; Phase 4 weightage remains configuration only (BR‑EX‑03, for the reports phase).
- **Unlocking hides the subject (D‑74):** while a subject is unlocked it disappears from the student's view, and the section's complete results and ranks are unavailable.
- **Behaviour deferred (D‑78).**

## Decisions requiring approval
- **D‑64:** exam lifecycle (stage separate from Active/Inactive).
- **D‑65:** applicability per class (all sections).
- **D‑66:** one authorised teacher per exam subject + section.
- **D‑67:** components with max > 0; two decimals.
- **D‑69:** the grade is taken from the subject percentage; no overall grade.
- **D‑70:** pass is decided on the total only.
- **D‑73:** competition rank among complete results, in the Phase 4 rank scope.
- **D‑74:** hidden while unlocked (replaces the D‑11 proposal).
- **D‑75:** roster date rule.
- **D‑78:** behaviour deferred to Phase 9.
- **D‑79:** permission mapping without new keys.
