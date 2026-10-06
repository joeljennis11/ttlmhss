# Open Decisions — TTLMHSS

Single list of decisions the specification leaves open or that need user confirmation. **Do not resolve any "Open" item silently** — ask the user, then record the answer here with the date.

Status: `Open` · `Proposed` (recommendation given, awaiting confirmation) · `Adopted` (implemented under a phase instruction; can still be revisited) · `Decided` (explicitly confirmed by the user).

## Technical

| ID | Decision | Recommendation / current state | Status |
|---|---|---|---|
| D‑01 | Language & repo layout | TypeScript; pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`) | Adopted in Phase 1 (Phase 1 instruction: follow the Phase‑0 architecture) |
| D‑02 | Frontend / backend frameworks | React + Vite SPA; Node.js + Fastify API | Adopted in Phase 1 (same basis) |
| D‑03 | ORM / query layer | **Kysely** behind repository interfaces — changed from the Phase‑0 proposal (Prisma/Drizzle) because it keeps one schema and one data layer working on several providers (architecture.md §8) | **Adopted — please confirm** |
| D‑04 | **Database provider** | Still undecided. The data layer supports SQLite and PostgreSQL via `DATABASE_URL`, both tested. Development/test default is SQLite (zero setup) — this is a development convenience, **not** a production choice. Recommendation for production: PostgreSQL | **Open — user decision** |
| D‑18 | Session strategy | **Server‑side sessions** (HMAC‑hashed token in DB) in an HttpOnly, SameSite=Lax cookie; idle + absolute timeouts. Rationale: real logout, immediate deactivation/scope changes (architecture.md §10) | Adopted in Phase 2 |
| D‑19 | PDF generation approach | HTML/CSS → headless Chromium (Playwright); good Tamil script support | Proposed |
| D‑20 | Hosting / deployment target | Depends on school's IT setup (cloud VM, PaaS, on‑premise). Also affects D‑04 | Open |
| D‑22 | Student/teacher login identifier | Default username = admission number / staff ID, lower‑cased, other characters → "-" (e.g. `2026/015` → `2026-015`); the administrator may type a different one at creation | Adopted in Phase 5 |
| D‑23 | Photo/certificate file storage | Still proposed (local disk behind an interface). Phase 5 shows initials; `students.photo_path` exists but no upload is built | Proposed |
| D‑27 | Frontend UI libraries | **Adopted in Phase 3:** React Router 8, CSS Modules + design tokens, lucide‑react icons, self‑hosted Public Sans / Source Serif 4. Not adopted: Tailwind, Radix, TanStack Query (unnecessary for the shell; revisit for data‑heavy modules) | Adopted — please confirm |
| D‑28 | TypeScript version | Pinned `~6.0.3` because typescript‑eslint does not yet support TS 7 | Adopted |

## Domain

| ID | Question | Proposed default | Status |
|---|---|---|---|
| D‑05 | How do mid‑year timetable changes relate to past attendance? | Versioned timetable; attendance snapshots teacher/subject. **Phase 6:** versions (effective from the publish moment). **Phase 7:** each register stores the timetable entry, version, subject and teacher; registers for a date use the version in force at the end of that school day | Adopted (Phase 7) |
| D‑06 | Can a Subject Teacher overwrite `L`/`C` set by the Class Teacher? | No — L/C are read‑only to subject teachers (implemented in Phase 7) | Adopted — please confirm |
| D‑07 | `0` represents both "scored zero" and "absent" — should absence be distinguishable in reports? | Keep `0` as the visible value; optionally store an internal absent flag so reports can count absentees. **Phase 8B:** `0` only, no absent flag (a flag can be added later without changing stored marks) | Open |
| D‑08 | Class‑teacher cardinality | **One ACTIVE class teacher per section per year** (enforced; replacing is deliberate). A teacher may be class teacher of several sections (Phase 5 spec: do not assume one) | Adopted in Phase 5 |
| D‑09 | Higher‑secondary groups/streams & electives (XI–XII groups, optional languages) — not every student in a section takes every subject | Support per‑student subject enrolment for exams/marks where needed. **Phase 8B:** not built — every student of a section is assessed in every subject configured for the class (a subject that only some take cannot be modelled yet) | **Open — important** |
| D‑10 | Rounding of percentages / normalized marks | Round half up to 2 dp; store raw. **Adopted in Phase 8B as D‑68** | Adopted (D‑68) |
| D‑11 | What students see when a submitted sheet is unlocked for correction | Proposal was: keep showing last submitted values. **Phase 8B (D‑74):** the subject is hidden until resubmitted | Decided differently — please confirm (D‑74) |
| D‑12 | Rank ties and who is ranked (e.g. students with an absent subject) | Competition ranking (1,2,2,4) of students with a complete result. **Adopted in Phase 8B as D‑73** | Adopted (D‑73) |
| D‑13 | Who records behaviour ratings | Class Teacher (+ Admin). **Adopted in Phase 9 (D‑81)** | Adopted |
| D‑14 | Request routing | Class Teacher of the student's section; Admin sees all. **Adopted in Phase 10 (D‑95)** | Adopted |
| D‑15 | "Permissions" management: fixed role map or Admin‑editable toggles; Class Teacher audit visibility | Phase 2: code‑defined defaults. **Phase 4:** Admin can adjust Teacher / Class Teacher / Student grants within fixed per‑permission ceilings (no escalation; ADMIN fixed); stored as overrides. Class Teacher has no `audit.view` by default (grantable). User‑specific permissions not implemented (needs Phase 5 account management) | Adopted in Phase 4 — please confirm |
| D‑16 | Class Teacher student‑management scope (edit which fields? promote?) | Phase 5: Class Teachers may view and edit the details (not identifiers or placement) of students in their own section through the API; admission, class changes, promotion, deactivation and deletion are administrator‑only (ceilings). No CT screens yet | Adopted — please confirm |
| D‑17 | Can Class Teacher edit the class timetable or only view? | **Phase 6:** view by default. The administrator may grant `timetable.manage` to Class Teachers (Permissions page); they can then edit the **draft** of their own class only (enforced per change on the server). Publishing stays administrator‑only (`timetable.publish`, never grantable) | Adopted — please confirm the default |
| D‑21 | Are sections defined per academic year or permanently? | Schema: sections are permanent (with status); the per‑year link comes from enrolments and class‑teacher assignments. Revisit if sections must differ by year | Adopted provisionally |
| D‑29 | Period structure scope | Periods/breaks belong to an academic year, so next year's timings can change without rewriting history | Adopted |
| D‑24 | Substitute / ad‑hoc teacher for a period (teacher absent) — who takes attendance? | Not in spec. Proposal: Class Teacher or Admin can mark; substitution feature only if requested | Open |
| D‑25 | Do internal/practical components have their own pass marks? | Configurable per component | Open |
| D‑26 | Leave entered after a subject teacher already marked `A` | Class Teacher's L replaces A, audited (implemented in Phase 7) | Adopted |

## Added in Phase 2

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑30 | Password policy | 8–128 chars, letter + digit, not common, not containing the username (BR‑AUTH‑05). Simple enough for students; raise for staff if wanted | Adopted — please confirm |
| D‑31 | Session lifetime | Idle 120 min, absolute 12 h (configurable by env) | Adopted — please confirm |
| D‑32 | Lockout policy | 5 failures → 15‑minute lock per username; 10 sign‑in requests/min per IP. A school network may put many users behind one IP — raise `LOGIN_RATE_LIMIT_PER_MINUTE` if that causes lockouts at the start of a period | Adopted — please confirm |
| D‑33 | Self‑service password reset (email/SMS) | Not provided: "Forgot password" = ask the school office, who issues a temporary password. Avoids needing email/SMS infrastructure | Adopted — please confirm |

## Raised when the logo arrived

| ID | Question | Notes | Status |
|---|---|---|---|
| D‑34 | Higher‑resolution / vector logo for print | First file was 556 × 556. An enhanced 8000 × 8000 JPEG was supplied with Phase 4 and is now the master (D‑40). A vector original would still be ideal but is not needed | Resolved in Phase 4 |
| D‑35 | Logo green vs brand colour | The logo's green measures ≈ `#345729`, lighter than the specified brand colour `#003300`; it also uses gold ≈ `#F6CB17`. Phase 3 keeps `#003300` as primary everywhere and uses the crest gold **only** as the active‑page marker / focus colour on the green sidebar | Provisional — please confirm |

## Added in Phase 4

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑36 | Must active exam weightages total exactly 100%? | Total may never exceed 100%; the screen marks it "complete" at 100%. Phase 8 should require 100% before annual results (BR‑EX‑03) | Adopted — please confirm |
| D‑37 | Grade scale shape | Grades defined by minimum percentage only (contiguous by construction), two decimals; one scale per exam with optional per‑subject override | Adopted — please confirm |
| D‑38 | Attendance cutoff day range | 1–28 so it exists in every month; unconfigured = no locking until the Admin saves a rule | Adopted — please confirm |
| D‑39 | Pass marks per component (D‑25) | Phase 4 stores one pass mark against the total; per‑component pass marks can be added in Phase 8 if needed. **Phase 8B:** not added — pass is decided on the total only (D‑70) | Open (D‑25) |
| D‑40 | Web logo source | The enhanced 8000 px logo supplied with Phase 4 (`assets/brand/ttlmhss-logo-enhanced.jpg`) is now the master for web and PDF; the original is kept unchanged for reference | Adopted |

## Added in Phase 5

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑41 | Configurable student profile fields (R‑4.8 / R‑5.2) | Not built: fixed groups Personal, Parent/Guardian, Contact, Address, Academic. Adding definitions + values tables is possible later without changing the identity/history model | Open — confirm whether needed |
| D‑42 | How first passwords reach students/teachers | New accounts get a random temporary password that is hashed and never shown (nobody knows it); the administrator presses "Issue temporary password", sees it once and hands it over. No email/SMS | Adopted — please confirm |
| D‑43 | Promotion dates | Promoted/not promoted: source placement ends on the source year's last day, new one starts on the target year's first day. Leavers: today (or source year end) | Adopted — please confirm |
| D‑44 | Mid‑year transfer across academic years | Not allowed: class changes stay within one year; moving into another year is promotion | Adopted |

## Added in Phase 6

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑45 | One timetable per year vs per section | One version per **academic year** covering every class (one draft, one live). Publishing is school‑wide, which keeps teacher clashes across classes checkable in one place | Adopted — please confirm |
| D‑46 | What "Save draft" means | Edits are validated by the server as they are made (dry run) and held in the page; **Save draft** stores the batch atomically; **Publish** needs no unsaved changes. Leaving the page with unsaved changes warns first | Adopted |
| D‑47 | Empty or invalid drafts | Publishing an empty draft is refused (it would blank the live timetable); lessons made invalid by later configuration changes are listed and block publishing | Adopted — please confirm |
| D‑48 | Teacher deactivation while timetabled | Allowed (Phase 5 behaviour unchanged); the lessons are flagged in the draft and block the next publish until reassigned. The live timetable keeps showing them until republished | Adopted — please confirm |
| D‑49 | Teacher access to students of classes they teach | **Phase 7:** only per lesson — a subject teacher sees the roster of a register for their own published lesson on that date and period; no general student‑list access | Adopted |
| D‑50 | Students' timetable page | API foundation only (`/timetable/students/:id`, own placement); **Phase 9:** the portal page uses it | Adopted |

## Added in Phase 7

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑51 | Meaning of `C` | Phase 7 instruction: **Permission / conditionally excused**, per student (earlier docs said "Cancelled" for a whole period). Shown as "Excused" with the full wording in help text. No reason list; optional note | Adopted — please confirm |
| D‑52 | Which statuses a subject teacher may set | `P`, `A` and `-` only; `L` and `C` belong to the class teacher / administrator (BR‑ATT‑05, CLAUDE.md) | Adopted — please confirm |
| D‑53 | Attendance on a configured non‑working day | Phase 7: refused for everyone, based on the year's weekly working days. **Superseded by D‑58 (Phase 8A):** the class‑aware academic calendar now decides; a special working day is added there instead of changing the weekly pattern | Superseded (Phase 8A) |
| D‑54 | Future dates | Registers can be viewed but not saved before the day | Adopted |
| D‑55 | Concurrent editing | Optimistic locking: each register has a revision; a save based on an older revision is refused with "reload". Multi‑period Leave/C saves always apply on top of the latest state | Adopted |
| D‑56 | Mark All Present | Sets only unmarked (`-`) students to `P`; P/A/L/C already chosen are kept (the UI says how many were kept). Nothing is saved until Save attendance | Adopted |
| D‑57 | Not‑marked lessons in student and class totals | Lessons that happened with no record count as `-` (shown, excluded from %) | Adopted |

## Added in Phase 8A

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑58 | Source of "is this a working day for this class?" | The academic calendar (weekly pattern + date entries per school / classes / sections), resolved only by `CalendarResolver`; replaces the year‑level check of D‑53 in attendance and timetable lessons. Still no attendance on a class's non‑working day, administrators included | Adopted |
| D‑59 | Overlapping entries | Refused (no precedence hierarchy): at most one entry per section per date | Adopted — please confirm |
| D‑60 | Class range | A UI convenience: resolved to explicit classes by display order when saved. Classes added to the school later are **not** added to existing entries | Adopted — please confirm |
| D‑61 | Timetable on special working weekdays | A section may hold lessons on a weekday only if it is a weekly working day or the weekday of a special working date for it; lessons still occur only on calendar‑working dates. If the same weekday later stops being special, those lessons are listed as problems at the next publish | Adopted — please confirm |
| D‑62 | Attendance on a date that later became a holiday | Kept, shown read‑only, and still counted (it was really recorded). Deleting the holiday makes it editable again | Adopted — please confirm |
| D‑63 | Calendar permissions | Reuses `config.manage` (School setup, administrators only); no new permission keys. Teachers/students consume the calendar only through attendance and timetable | Adopted |

## Added in Phase 8B

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑64 | Exam lifecycle | A separate `stage` DRAFT → OPEN → CLOSED (reopen allowed; back to draft only without marks) next to the Phase 4 ACTIVE/INACTIVE status. New exams start as DRAFT; exams that existed before 8B became DRAFT | Adopted — please confirm |
| D‑65 | Class/section applicability | Kept at the Phase 4 level: exam subjects per exam **and class**; every active section of the class has a sheet. Excluding one section of a class from a subject is not possible | Adopted — please confirm |
| D‑66 | Mark‑entry authorisation | ONE teacher per exam subject + section, stored on the mark sheet, chosen by the administrator from active teachers who teach the subject; re‑checked on every request (removing the subject or deactivating the teacher removes access). No sheet teacher = administrators only. Multiple teachers per sheet: not supported (keeps "who entered what" unambiguous) | Adopted — please confirm |
| D‑67 | Components and decimals | A component is marked when its maximum is above 0; marks to two decimals; a student is "entered" only with every component | Adopted — please confirm |
| D‑68 | Rounding (D‑10) | Exact integer arithmetic; normalised marks and percentages rounded half up to two decimals, once. Subject % uses raw total ÷ raw maximum; exam % uses Σ final marks ÷ Σ final maximums | Adopted |
| D‑69 | Which mark the grade uses | The subject percentage (raw ÷ raw maximum, = normalised ÷ normalised maximum up to rounding); grade scale = subject override else exam scale; no scale → no grade. No overall exam grade | Adopted — please confirm |
| D‑70 | Pass/fail (D‑25/D‑39) | Raw total ≥ the subject's pass marks; no per‑component pass rule. Overall pass = every counting subject passed | Adopted — please confirm |
| D‑71 | Complete result | Every subject with "counts in result" submitted for the student's section and marked for the student. Non‑counting subjects are shown, not required | Adopted |
| D‑72 | Settings kept with submitted marks | Submission stores the derived values and the settings used (maximums, pass marks, convert‑to, grade bands). Grade‑scale edits after submission do not change submitted results; exam‑subject settings cannot change while a sheet is submitted | Adopted |
| D‑73 | Rank (D‑12, BR‑RS‑05) | Standard competition ranking (1, 2, 2, 4) on the total among students with a complete result in the exam's Phase 4 rank scope (section by default, class if configured); shown "rank / number ranked" | Adopted — please confirm |
| D‑74 | Visibility during correction (D‑11) | An unlocked sheet is hidden from students (and complete results/ranks of that section are unavailable) until it is resubmitted — no "last submitted" copy is kept | Adopted — please confirm |
| D‑75 | Roster for a sheet | Students placed in the section on the exam's end date (else start date, else today; clamped to the year), plus anyone already holding marks on the sheet. Students who joined after or left before that date are not on the sheet | Adopted — please confirm |
| D‑76 | Placement used by results | Where the student's marks are; else the placement on the roster date. Later transfers/promotions never move a result | Adopted |
| D‑77 | Exam dates vs academic calendar | Independent; a start/end date that is not a working day for any class shows a warning only | Adopted |
| D‑78 | Exam‑linked behaviour | **Deferred to Phase 9.** Phase 4 has categories and 1–5 labels but not who records (D‑13 still proposed), when ratings become visible, or whether they lock like marks; Phase 9 is "Student portal, behaviour and achievements" | Resolved in Phase 9 (D‑81–D‑86) |
| D‑79 | Permissions for 8B | No new keys. `exams.manage` (admin): lifecycle and mark‑entry teachers; Phase 4 `config.manage` keeps the exam/subject settings. `marks.view` + per‑sheet scope to open sheets; `marks.enter` / `marks.submit` for the authorised teacher; `marks.edit` (class teacher ceiling) = unlock and correct own section; `results.view`: students own results, class teachers own section, admins all | Adopted — please confirm |
| D‑80 | Audit redaction | The audit redactor no longer masks keys such as `passMarks`/`passed` (it matched "pass"); passwords, secrets, tokens and hashes are still masked | Adopted |

## Added in Phase 9

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑81 | Who records behaviour (D‑13) | Administrators (any section) and the class teacher of the section in that year with `behaviour.manage`; subject teachers never. A teacher granted `behaviour.manage` without a class‑teacher assignment still has no section | Adopted — please confirm |
| D‑82 | Behaviour workflow | One sheet per exam + section: **Draft → Submitted**. Submit needs every on‑roll student rated in every active category. A submitted sheet is corrected in place with a mandatory reason (audited old → new); it stays visible to students with the corrected values. No unlock state (unlike marks, behaviour has no derived results to hide) | Adopted — please confirm |
| D‑83 | When behaviour can be recorded | Same lifecycle as marks: exam active and OPEN, year not closed; the class must take the exam. Closing the exam freezes behaviour | Adopted — please confirm |
| D‑84 | Rating labels over time | Labels are copied onto each rating at submission and at every correction, so annual reports show the meaning that applied; drafts show today's labels | Adopted |
| D‑85 | Behaviour permissions | No new keys: `behaviour.view` (students own submitted, class teachers own section, admins all), `behaviour.manage` (record, submit and correct — correction is distinguished by the mandatory reason, not a separate permission) | Adopted — please confirm |
| D‑86 | Rating control | A drop‑down per category showing "n — label" instead of five radio buttons (BR‑BH‑02 mentions radio buttons): a class grid of students × categories with radios would be unusably wide; phones get one card per student | Adopted — please confirm |
| D‑87 | Achievement deletion | Archive / restore for administrators and class teachers; permanent delete only for administrators and only after archiving; archived achievements are hidden from students and not editable | Adopted — please confirm |
| D‑88 | Achievement attachments | Not built: no file‑storage facility exists yet. `achievements.attachment_ref` is reserved and the UI shows an indicator when set. Needs a storage decision (with Phase 11 documents) | Deferred — needs decision |
| D‑89 | Portal navigation | Students: Home, My portal, My profile, Timetable, Attendance, Marks & results, Behaviour, Achievements. Staff "Results" no longer lists students (their results moved to `/portal/results`) | Adopted |
| D‑90 | Student attendance detail | The Phase 7 student view now also returns the lesson's teacher (register snapshot, else timetable) and offers a per‑lesson list (date, period, subject, teacher, status) | Adopted |

## Added in Phase 10

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑91 | How dashboards get their data | One aggregated `GET /dashboard` per user. Each block calls the existing source‑of‑truth service with the caller's own identity (no new calculations or definitions; the administrator's counts are the totals of the same repository queries the Students and Teachers lists use, and today's notes are the calendar entries the `CalendarResolver` uses); a block the caller may not see is left out instead of failing. Two read‑only views were added to the attendance service for this: the administrator's school day (`schoolDay`, the class‑day lesson logic for every section) and the student's own day (`myDay`) | Adopted |
| D‑92 | "Not started" mark sheets | Assigning a mark‑entry teacher creates an empty DRAFT sheet; dashboards count a sheet as *Not started* until at least one student's marks are entered. Teacher tasks: Not started → Draft → Ready to submit (every student entered) → Submitted; Unlocked = Needs correction | Adopted |
| D‑93 | Student dashboard attendance | The My attendance page's default range (today and the 27 days before, clipped to the year start), from the same service, so the numbers always match | Adopted |
| D‑94 | Request lifecycle | Open → In review → Resolved → Closed, reopen → Open with a reason. No *Rejected*: a request that needs no change is resolved (or closed) with a note saying so — one fewer state for students to understand | Adopted — please confirm |
| D‑95 | Request routing (D‑14) | Attendance issue and result clarification → the class teacher of the student's current section (assigned automatically) + administrators; profile correction → administrators only. Subject teachers get no request access (granting them would need a per‑request relevance rule); the reviewer contacts the subject teacher. Only administrators re‑assign (to an administrator or the class teacher) | Adopted — please confirm |
| D‑96 | Announcement audiences and management | Audiences SCHOOL, STAFF, CLASS, SECTION as structured columns. Class teachers may target only their own section (not the whole class or the school — no existing permission allows it). "Publish now" or save a draft — no scheduled publishing. Expiry is an inclusive date. Archive instead of delete; restore returns to the previous state | Adopted — please confirm |
| D‑97 | Request limit | At most 10 Open/In‑review requests per student, to keep the queue usable; more are refused with a clear message | Adopted — please confirm |
| D‑98 | Permissions for Phase 10 | No new keys: `announcements.view` (read own audience), `announcements.manage` (admin all; class teacher own section), `requests.view` (student own; class teacher own section; admin all), `requests.create` (students), `requests.handle` (status changes; assignment is administrator‑only). Request history comes from the audit trail — no separate history table | Adopted |
| D‑99 | Audit activity on the admin dashboard | Not shown: there is no readable audit viewer yet (`audit.view` is reserved), and raw before/after data does not belong on a home screen. Candidate for Phase 12 | Deferred |
| D‑100 | Class teacher "View students" | Not offered as a quick action: class teachers have no student list page (the Students page is administrator‑only). The class attendance day lists the class's students | Adopted |

## Added in Phase 11

| ID | Question | Current default | Status |
|---|---|---|---|
| D‑101 | PDF and Excel libraries | **PDFKit** (server‑side, pure JS, A4, no browser) for PDFs and **ExcelJS** for `.xlsx`. Standard PDF fonts (Helvetica): Latin text only — characters they cannot draw (e.g. Tamil) are printed as "?" (an embedded Unicode font is a later option) | Adopted — please confirm |
| D‑102 | Annual calculation | Σ (Phase 8B exam percentage × configured weightage) ÷ 100, half‑up 2 dp (`annualPercentBp`). Only when the year's active weightages total 100 % and every weighted exam's result is complete for the student. No annual grade, pass/fail or rank (no rule exists) | Adopted — please confirm |
| D‑103 | Annual lifecycle and roles | Draft → Finalized → Published (+ unpublish; reopen Finalized → Draft with a reason). Class teacher of the section and administrators prepare, write the remark and finalize; **only administrators publish, unpublish and reopen** | Adopted — please confirm |
| D‑104 | Snapshot strategy | Only annual reports are stored: the complete display‑ready content as JSON (`annual_reports.snapshot_json`) at finalization. Report cards, mark sheets, attendance and performance reports are generated on request from current data and are not stored | Adopted |
| D‑105 | Incomplete results | Previews show what is published with "Incomplete"; the official report‑card PDF is refused until the result is complete (Phase 8B) | Adopted |
| D‑106 | Suggested remark | One factual sentence (annual %, attendance %, counts) — no judgement bands invented; labelled "System suggestion", drafts only, never printed on an official report; a teacher may start from it but must save their own remark | Adopted |
| D‑107 | Signatures | Lines with role labels (Class Teacher; Subject Teacher on mark sheets; Principal / Head of Institution). The principal's name is printed only when configured in School details; no signature images | Adopted |
| D‑108 | Mark sheet of a draft | Staff may print a non‑submitted sheet; it carries a "Not final — not visible to students" banner | Adopted |
| D‑109 | Report permissions | No new keys: `reports.view` + the scope of the service each report comes from; `reports.generate` for the annual report lifecycle (and the class lists for it). Subject teachers: mark sheets of their own sheets only | Adopted |
| D‑110 | Student attendance in reports | Any date range within one academic year; the class report adds an Excel export. A timetable published mid‑range only creates lessons from its publication (Phase 6/7 rule) | Adopted |
| D‑111 | Phase doc location | `docs/phases/phase-11.md` (the project's convention) instead of `docs/phase-11.md` | Adopted |

## Pending inputs from the user

- ~~Official school logo file~~ — **received 2026‑10‑03** (`assets/brand/ttlmhss-logo-official.jpg`); an enhanced 8000 px version followed with Phase 4 (`ttlmhss-logo-enhanced.jpg`, now the master — D‑34 resolved for print size).
- School address, contact details, and signatory names/titles for PDFs.
- Current class/section list, subject list, period timings, exams, grade scale, motto and principal's name — the Phase 4 screens are ready; the school (or the developer with the school's data) enters them. Nothing has been pre‑filled.
