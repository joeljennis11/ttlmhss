# Phase 12B — Full integration and QA

**Scope:** check that the modules work as ONE system, fix the real defects found, add regression tests. No new features, rules, reports, deployment or hosting work; Phase 12C is not started. No migration.

## Starting point

HEAD `3fa1a3f` (Phase 12A), clean working tree, migrations 0001–0013, 463 tests + 67 browser tests.

## Integration checks (new `apps/api/test/phase12b.test.ts`, SQLite and PostgreSQL)

One school is built **only through the real APIs**: academic year, working days, periods, class + sections, subjects; teachers added through the API with issued temporary passwords and a forced first password change; Teacher → Subject; class‑teacher assignment; students admitted through the API (account, temporary password, first sign‑in blocked until the password is changed); draft → publish timetable; exam with a 50‑mark paper converted to 100; mark‑entry teachers. Then:

| Test | What crosses module boundaries |
|---|---|
| Timetable → attendance | The published lesson appears in the teacher's lessons and the student's day; the register shows the right subject, teacher and roster; another teacher, another class's teacher, a period without a lesson and a student are refused |
| Class change | Attendance and the exam in X‑A, transfer to X‑B, attendance in X‑B: the old register is unchanged, the student's attendance spans both classes (50 %), class totals stay with the class of the lesson, the Term 1 result and rank stay in X‑A, X‑B's mark sheet and behaviour sheet do not list the student (roster date), the profile shows X‑B with two placements, the report‑card PDF prints X‑A and 75 %, the X‑B Excel lists the right roll number |
| Calendar after attendance | A section holiday added after a register was saved: read‑only with the holiday explanation (D‑58–D‑62), other section unaffected, removing the holiday restores editing |
| Marks → results | Draft with a blank stays hidden; 42.5/50 → 85; 0 is a real zero; a failing subject; tie → shared rank 1 and next rank 3; unlock hides the subject and the summary; resubmission restores it; another student's result refused |
| Class‑teacher replacement, teacher deactivation | Ending an assignment removes the old class teacher's report access at once, the new one gains it; a deactivated teacher is signed out; the published timetable keeps the history |
| Requests and announcements after a class change | Routing (D‑118), inboxes, subject teacher has no access, profile corrections to the office; section announcements follow the current placement; a class teacher cannot post to another section; resolving a request changes no register |
| Concurrency | A stale attendance save and a stale marks save are refused (409, "reload" message) with no partial write |

Behaviour, achievements, announcements lifecycle, annual reports (draft → finalize → publish → reopen → republish, weighting, frozen snapshot), every report type's content and the permission matrix per module were already covered end‑to‑end by the Phase 9–11 suites; they were re‑run unchanged. The Phase 12A security suite (configuration, CORS, cookies, headers, rate limits, RBAC sweep of every route, IDOR) was re‑run unchanged.

## Defects found and fixed

| # | Defect | Where | Fix |
|---|---|---|---|
| B1 | **PostgreSQL only:** the class attendance lesson‑by‑lesson list (preview, PDF, Excel) showed a transferred student's **old** roll number. The roster map kept "the last placement" and the placement query had no ORDER BY, so the result depended on the database's row order | `AttendanceViewService.classRegister`, `KyselyAttendanceRepository.placements` | Each lesson cell carries the roll number of the placement in force that day; the placement query is ordered (`started_on`, `id`) so every database returns the same order |
| B2 | A request about a lesson or exam from **before a class change** went to the current class teacher, who has no scope over the earlier class's register or marks, while the class teacher who could act never saw it | `RequestService.create` | Stored against and routed to the placement it concerns (D‑118); BR‑RQ‑02 updated |
| B3 | Accessibility: the timetable's empty‑cell text ("Free") had 3.7:1 contrast (WCAG AA needs 4.5:1) | `timetable.module.css` | Uses `--ink-muted` |
| B4 | Accessibility: the timetable version‑history table scrolls horizontally but could not be reached by keyboard | `EditorPage.tsx` | `role="region"`, label, `tabIndex=0` (as the other scroll regions) |
| B5 | Accessibility: closing any form or confirmation dialog dropped keyboard focus to the page instead of the button that opened it | `Dialog.tsx`, `ConfirmDialog.tsx` | Shared `useModalDialog` restores focus (D‑119); web test `test/phase12b.test.tsx` |

An observation that is not a defect: admission numbers and staff codes produce usernames the same way, so `INT/1` and `INT-1` would both want `int-1`; the second gets a clear "username already in use, enter a different one" message.

## Browser QA

- Full Playwright suite: 67/67.
- Built app (production bundle under its CSP, `vite preview`) loaded with the data left by the e2e run: **58 pages × 4 widths (1440, 1280, 820, 390 px) = 232 views**, across the admin, teacher, class teacher and student roles. For each view: horizontal page overflow, console errors, duplicate API calls, load time; axe‑core (WCAG 2 A/AA + best practice, serious/critical) at 1440 and 390 px. First run: 8 views with findings (B3, B4); after the fixes: **0**.
- Keyboard: sign‑in by keyboard only, skip link is the first stop in the shell, dialogs take focus, Escape closes and focus returns to the opener (B5), invalid form fields are `aria-invalid` with `aria-describedby` pointing at the message.
- Screens reviewed visually on phone width (reports, results, class attendance, students): consistent branding, components and spacing; no redesign was needed.

## Database QA

Every integration test runs on SQLite and on PostgreSQL (PGlite). B1 was the only difference found; the fix also makes the placement order explicit for every other caller.

## Performance

- No duplicate API calls on any of the 232 views; 2–7 requests per page.
- Slowest page loads ≈ 0.7–1.2 s in the preview setup (local API, SQLite), including the dashboards, timetable editor, class attendance and reports.
- Lists are paginated (≤ 100); report ranges stay inside one academic year (Phase 12A).
- Bundle: 817 KB / 222 KB gzip, +4 % since Phase 10/11 — documented, not split (D‑120).

## Known limitations

- The per‑IP sign‑in limit may be too low for a whole class signing in from one school network (D‑121, for 12C).
- Browser QA used the synthetic e2e data set; very large classes/years were not load‑tested (not in scope).
- Rate‑limit counters, `frame-ancestors`/HSTS on the web host and `TRUST_PROXY` remain 12C deployment items (Phase 12A).

## Commands

No migration and no dependency change: nothing to run for this phase.
