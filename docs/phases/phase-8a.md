# Phase 8A — Academic / Working‑Day Calendar

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting the next instruction (Phase 8B not started).

## Objective
An administrator‑only academic calendar that decides whether a date is a working day for each class and section. Holidays and special working days can apply to the whole school, some classes or some sections. Attendance and timetable lessons now follow this calendar instead of the year's weekly working days alone.

## Starting state
Phase 7 committed (`1c5ef30`; 309 tests, 41 e2e). Working days existed only as a weekly pattern per academic year (`academic_years.working_days`). Attendance refused any date outside that pattern (D‑53), and the timetable accepted lessons only on those weekdays.

## What was implemented
**Database** — migration `0009_academic_calendar` (database‑design.md §5e):
- `calendar_entries`: date, WORKING/HOLIDAY, scope SCHOOL/CLASSES/SECTIONS, reason, note, who and when.
- `calendar_entry_targets`: the classes or sections an entry applies to.
- There can be one whole‑school entry per date, and the Phase 4 classes and sections are referenced, never copied.

**Resolution** (BR‑CAL‑01…04) — one rule, `resolveWorkingDay` (shared) / `CalendarResolver` (API):
1. A date outside the academic year → not working.
2. Otherwise, the one entry that applies to the class/section → its status.
3. Otherwise → the weekly pattern.

Entries never overlap, so no precedence is needed:
- At most one entry may apply to any section on a date.
- The whole school overlaps everything; a class overlaps itself and its own sections.
- An overlap is refused, and the message names the existing entry.
- Entries that would change nothing are refused (a Working day on a weekly working day, or a Holiday on a weekly closed day).

**Class applicability** — entire school, specific classes or specific sections. A class range (e.g. 11 to 12) is chosen in the configured class order, never by comparing names, so PreKG/LKG/UKG/1…12 work. It is saved as explicit classes.

**Integration**
- *Timetable:*
  - A section may hold lessons on its weekly working days plus the weekdays of special working dates that apply to it. Example: Saturday lessons for 11–12 become possible once a Saturday is a special working day for them.
  - The published timetable remains the only source of lessons; a working day never invents one.
  - The class timetable grid shows those extra days, and `/timetable/lessons` filters by the calendar.
- *Attendance:* every check that used `year.workingDays` now asks the resolver (register, save, the teacher's lessons and Take attendance, class day, class totals, student view, student day, multi‑period Leave/C). On a class's non‑working date:
  - no register can be created;
  - no lesson is offered;
  - nothing is counted, so percentages are unchanged.
- *History:* registers saved on a date that later becomes a holiday are kept, shown read‑only with the reason, and still counted. Removing the holiday makes them editable again.

**Admin UI** — School setup → **Calendar** (`/admin/academic-calendar`):
- Year selector and the weekly pattern.
- Month grid: each day says Working, Closed or Outside year in words, with entries as labelled chips with icons and a "+" per day.
- On phones, the month's entries are shown as a list.
- Table of all entries (date, status, applies to, reason, added by, Edit/Delete).
- Add/edit dialog:
  - fields: date with a hint showing the weekly pattern, status, entire school / class range / classes / sections, reason and note;
  - client‑side checks use the shared schema;
  - the server's overlap message is shown in the dialog;
  - closing with unsaved changes asks first.
- Delete asks for confirmation and explains that saved attendance is not changed.

**Audit** — `calendar.entry_created`, `calendar.entry_updated` and `calendar.entry_deleted`, recording the actor, time, year, date, old and new status, applicability, reason and note.

**Permissions** — reuses `config.manage` (administrators only), with no new keys. Teachers and students are refused on all four routes; signed‑out calls get 401.

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (format, lint, typecheck, unit/integration/component) | clean — **335 tests in 24 files** (Phase 7: 309) |
| Shared `calendar.test.ts` (11) | class ranges by display order (10–12; PreKG–UKG; either end first; 1–10 = 10 classes) · A weekly default · B whole‑school holiday · C class holiday 1–10 with 11–12 working · D/E special Saturday for 11–12 and Sunday for 12 only · section‑only holiday · I different classes on one date · overlap rule · input schema |
| API `calendar.test.ts` (5 × SQLite and PostgreSQL) | CRUD with readable applicability and per‑section resolution (A–I) · M validation: overlaps (school / class / section of a class), no‑effect entries, dates outside the year, unknown classes, bad input (400), closed year · L audit of create/update/delete with before/after · K teachers and students 403, signed out 401 · H the timetable refuses a Saturday lesson until the calendar allows it, publishes it after; registers open on the special Saturday but not the next Saturday, are refused for the class holiday but work for another class that day, and are refused for everyone on a whole‑school holiday; lessons views filtered; Saturday attendance saves; holidays add nothing to totals · J a later holiday keeps the saved register (read‑only, still counted); deleting the holiday makes it editable again. Mutation check: disabling the calendar check in attendance fails test H |
| Web `calendar.test.tsx` (5) | month grid, words not colour, entry list · class range in configured order sends explicit classes · missing reason caught before sending, server overlap shown · discard‑changes and delete confirmations · teachers get "no access" |
| `pnpm --filter @ttlmhss/web test:e2e` | **44/44**. New (3): administrator opens Calendar, adds a whole‑school holiday, adds a section‑specific special working day, sees an overlap refused, edits; a holiday today for TEST‑CLASS B blocks its register (409 with the reason) and removes the lesson from the teacher's list; deleting it restores the normal flow; clean‑up · teachers cannot open or call the calendar · tablet/phone with no page overflow. All Phase 1–7 flows pass. |
| `pnpm build` | builds (web JS 653 KB / 184 KB gzip) |
| Migrations | `0009` applies and rolls back on both providers; applied to the development database |
| Manual | screenshots at 1440/820/390 px and of the dialog, reviewed |

## Out‑of‑scope check
No exams, marks, results, behaviour, achievements, reports, PDFs, dashboards, announcements, requests, notifications or leave applications were added. The only changes outside the calendar module are its hooks in timetable and attendance.

## Known limitations
- **Class ranges are saved as a fixed list:** classes added later are not added to existing entries (D‑60).
- **No admin override for non‑working dates:** even administrators cannot create attendance there (D‑58).
- **Weekday‑level timetable lessons:** a special working Saturday uses the section's Saturday lessons. There is no "follow Monday's timetable" option and no one‑day timetable (out of scope; would be a timetable change).
- **Changing the weekly pattern is not re‑validated against entries:** it can make an existing entry have no effect. That is harmless, but the entry stays listed.

## Decisions requiring approval
- **D‑59:** overlapping entries are refused (no precedence hierarchy).
- **D‑60:** class ranges are saved as explicit classes.
- **D‑61:** timetable lessons are allowed on special working weekdays.
- **D‑62:** attendance saved on a date that later becomes a holiday is kept, read‑only and counted.
