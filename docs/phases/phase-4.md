# Phase 4 — Admin + School Configuration

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting explicit Phase 5 instruction.

## Objective
Give administrators a real, backend‑enforced School setup area for the structure and rules every later module depends on — without building students, teachers, timetables, attendance, marks or any other later module.

## Starting state
Phase 3 committed (162 tests, 16 e2e). Tables for years, classes, sections, subjects and periods existed (Phase 1) with no screens or endpoints. The enhanced 8000 px logo was supplied with this phase's instruction.

## What was implemented
**Logo.** The enhanced file is stored unmodified as `assets/brand/ttlmhss-logo-enhanced.jpg` (SHA‑256 recorded) and is now the master; the original is kept. `brand:assets` regenerates the web logo (512 px WebP), favicon and touch icon from it by **resizing only**.

**Database** — migration `0005_school_configuration` (database-design.md §5a): school motto/website/principal; working days per year; subject display order; case‑insensitive unique names; tables `attendance_policy`, `grade_schemes`, `grade_bands`, `exams`, `exam_subjects`, `behaviour_categories`, `achievement_categories`, `behaviour_rating_labels`, `role_permission_overrides`. Percentages as integer hundredths. No rows inserted.

**API** — `modules/config/` (architecture.md §12): 43 `/api/v1/admin/*` endpoints, each requiring `config.manage` (role permissions: new `permissions.manage`), re‑checked in every service method; every change audited in the same transaction; field‑level conflict errors.

**Rules** (business-rules.md BR‑CFG‑01…12): no overlapping years, deliberate "make current", deletion only when nothing depends on the record (otherwise deactivate); periods/breaks validated for overlaps, duplicate numbers and order; attendance cutoff 1–28 or no locking (unconfigured = never locks); grade scales without overlaps or gaps by construction; exam weightage never above 100 % with a "complete" indicator; exam subjects per exam × class with theory/internal/practical maxima, pass marks ≤ total, optional conversion, inclusion in result and grade‑scale override; five rating labels.

**Role permissions** (permissions.md §8): Admin can adjust Teacher, Class Teacher and Student grants within fixed per‑permission ceilings; ADMIN is fixed; changes apply on the next request; above‑ceiling requests are rejected and never stored, and stored rows are clipped at runtime.

**Web** — "Administration → School setup" in the sidebar (only with `config.manage`), an overview page, in‑page setup navigation and 12 pages: School details (incl. "use the official logo", fixed colour, current year), Academic years, Classes & sections, Subjects, Periods & breaks (year selector, working days, copy from another year), Attendance locking (live example), Grade scales (live range preview), Exams (weightage meter), Exam detail (subjects grid per class), Behaviour (categories + labels, "add suggested"/"fill in suggested" only on request), Achievement categories, Role permissions (role tabs, locked ceilings, inherited‑from‑Teacher marks, confirm with a summary, reset to defaults). Home shows an "Open school setup" entry for administrators (no statistics). Name changes refresh the branding immediately.

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (lint, format, typecheck, unit/integration/component) | clean — **215 tests in 14 files** (Phase 3: 162) |
| API (`test/config-admin.test.ts`, 28 tests) | every area on **SQLite and PostgreSQL (PGlite)**: validation, case‑insensitive duplicates, overlaps, deletion rules, weightage limit, exam subjects, audit rows, branding update; security: **401** on all 43 admin routes signed out, **403** for teacher, class teacher, student and temporary‑password admin on all of them, malformed ids, no internal details in errors; permissions: defaults inside ceilings, admin‑only keys outside every ceiling, above‑ceiling saves rejected with nothing stored, change visible on the next request and audited, tampered DB row ignored |
| Shared (`config.test.ts`) | lock dates, grade bands, normalization, schemas |
| Web components (`admin.test.tsx`) | no menu/no access for teachers, overview links, client + server field errors, save + branding refresh, permission ceilings and confirm, inherited permissions, grade preview |
| `pnpm --filter @ttlmhss/web test:e2e` | **26/26** — 10 new admin flows through the real API (access denial for three roles, every configuration area, overlap/duplicate/weightage/pass‑mark errors, permission change reaching a teacher session, phone‑width overflow) |
| `pnpm build` | shared, api, web build (web JS 483 KB / 144 KB gzip) |
| Dev database | `pnpm db:migrate` applied 0005 to the existing dev database without data loss |
| Visual review | 46 screenshots at 1440×900, 820×1180, 390×844 on a throwaway database with labelled sample data; 0 px horizontal overflow on every page |

## Issues found and fixed during this phase
1. Validation reads used the non‑transactional store inside a write → hung on SQLite; now use the transaction's repositories (documented in architecture §12).
2. Visually hidden button labels inside scrolling tables widened the page on phones → table wrapper positioned.
3. Tables were cramped on phones → stacked card layout below 768 px.
4. Setup navigation overflowed on desktop → short labels (full title as tooltip), wraps on wide screens, scrolls on small ones.
5. Disabled secondary/ghost buttons looked enabled → disabled styles.
6. Exam detail grid scrolled at 1440 px; row actions wrapped → compacted.
7. API lacked a single‑exam read for the exam page → `GET /admin/exams/:id` added (tested).

## Known limitations
- **User‑specific permissions** are not implemented (no account‑management screens until Phase 5).
- Student profile field configuration (R‑4.8) moves to Phase 5; an audit‑log viewer (R‑4.10) is not built — changes are recorded.
- The role‑permission cache is per API process (30 s); several processes converge within 30 s.
- Period deletion is allowed until timetables exist; Phase 6/7 must block it once periods are referenced (the FK is RESTRICT).
- One pass mark per subject total (per‑component pass marks: D‑25/D‑39).
- Exam marks grid scrolls sideways on phones (data entry grid).
- No school data has been entered: the screens are ready for the school's real classes, subjects, timings, exams and grade scale.

## Files added / changed (main)
- Added: `assets/brand/ttlmhss-logo-enhanced.jpg`; shared `config.ts`, `permission-info.ts` (+ test); API `migrations/0005_school_configuration.ts`, `repositories/config/*`, `modules/config/*`, `test/config-admin.test.ts`; web `features/admin/**`, `lib/{use-resource,use-form-submit,format}.ts`, `components/ui/{Dialog,StatusBadge}.tsx`, `test/admin.test.tsx`, `test/support/admin-fixtures.ts`, `e2e/admin-config.spec.ts`.
- Changed: brand script + regenerated `public/brand/*`; shared `auth.ts` (`permissions.manage`); API role‑permission service, principal/auth wiring, data store, school settings repository, errors; web routes, navigation/sidebar (Administration section), BrandingProvider (refresh), Field (select/textarea/checkbox), Page (actions), Home, ui styles, tests; docs.

## What Phase 5 needs to know
- Read classes, sections, subjects and the current year through the existing repositories; only ACTIVE ones should be offered for new records.
- Account creation (teacher/student) and user‑specific permissions can reuse the override + ceiling model (`PERMISSION_INFO`, `RolePermissionService`).
- Student profile field configuration (R‑4.8) belongs with student management.
