# Phase 0 — Initialization, Master Specification & Architecture

**Date:** 2026‑10‑02
**Status:** Complete. Awaiting explicit Phase 1 instruction.

## Repository state at start
New, empty project. No code, configuration, or prior documentation existed. A fresh git repository was initialised.

## What was done
- Created `CLAUDE.md` — the permanent project constitution: phase control, per‑phase workflow, roles, condensed business rules, architecture principles, branding/UI rules, PDF rules, documentation map.
- Created `docs/requirements.md` — complete functional and non‑functional requirements, mapped to planned phases, plus explicit out‑of‑scope list.
- Created `docs/business-rules.md` — critical rules with stable IDs (BR‑AY, BR‑TT, BR‑ATT, BR‑MK, BR‑RS, …) for traceability in code and tests.
- Created `docs/permissions.md` — role + scope model (Class Teacher as a scoped assignment on a Teacher), permission matrix, enforcement rules.
- Created `docs/architecture.md` — proposed stack, layering, API style, auth/authz/service/data/report boundaries, configuration, testing and security baseline.
- Created `docs/database-design.md` — provider‑agnostic conceptual entity model and integrity rules, with Enrolment as the history‑preserving core.
- Created `docs/decisions.md` — register of open/proposed decisions and pending inputs.
- Created a minimal `README.md`.

## What was deliberately NOT done
No application code, packages, framework scaffolding, database schema, authentication, application shell, UI, or any feature from Phases 1–12. No database provider was selected. No logo or placeholder logo was created.

## Key risks / conflicts identified
1. **Streams and electives (D‑09):** Higher Secondary groups mean students in one section may take different subjects. Marks, results and ranking need per‑student subject applicability. Should be settled before Phase 1 data‑layer work.
2. **`0` as both zero and absent (D‑07):** reports cannot count exam absentees unless an internal flag is kept.
3. **Timetable changes vs history (D‑05):** attendance must snapshot teacher/subject so re‑publishing doesn't rewrite history.
4. **Attendance precedence (D‑06, D‑26):** conflicting edits between subject teacher (P/A) and class teacher (L/C).
5. **Unlock after visibility (D‑11):** what students see while a submitted subject is being corrected.
6. **Substitute teachers (D‑24):** not covered by the spec.
7. **Tamil script in PDFs:** influences PDF tooling (D‑19).
8. **Minors' personal data:** privacy and access minimisation should be considered in hosting and access decisions.

## Next
Wait for the user to unlock Phase 1. Before Phase 1, ideally confirm D‑01–D‑04 and D‑09.
