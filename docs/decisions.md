# Open Decisions — TTLMHSS

Single list of decisions the specification leaves open or that need user confirmation. **Do not resolve any "Open" item silently** — ask the user, then record the answer here with the date.

Status: `Open` · `Proposed` (recommendation given, awaiting confirmation) · `Decided`.

## Technical

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| D‑01 | Language & repo layout | TypeScript; pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`) | Proposed |
| D‑02 | Frontend / backend frameworks | React + Vite SPA; Node.js + Fastify API | Proposed |
| D‑03 | ORM / query layer | Prisma or Drizzle behind repository interfaces | Proposed |
| D‑04 | **Database provider** | Relational; PostgreSQL preferred. **Explicitly undecided per spec.** | **Open — user decision** |
| D‑18 | Session strategy | Server‑side sessions with httpOnly cookies (vs JWT) | Proposed |
| D‑19 | PDF generation approach | HTML/CSS → headless Chromium (Playwright); good Tamil script support | Proposed |
| D‑20 | Hosting / deployment target | Depends on school's IT setup (cloud VM, PaaS, on‑premise) | Open |
| D‑22 | Student/teacher login identifier | Students: admission number; Teachers: staff ID or email | Open |
| D‑23 | Photo/certificate file storage | Local disk behind an interface (swap to object storage later) | Proposed |

## Domain

| ID | Question | Proposed default | Status |
|---|---|---|---|
| D‑05 | How do mid‑year timetable changes relate to past attendance? | Versioned timetable with effective‑from date; attendance snapshots teacher/subject | Proposed |
| D‑06 | Can a Subject Teacher overwrite `L`/`C` set by the Class Teacher? | No — L/C are read‑only to subject teachers | Proposed |
| D‑07 | `0` represents both "scored zero" and "absent" — should absence be distinguishable in reports? | Keep `0` as the visible value; optionally store an internal absent flag so reports can count absentees. Needs user decision | Open |
| D‑08 | Class‑teacher cardinality | One class teacher per section per year; a teacher holds at most one class | Proposed |
| D‑09 | Higher‑secondary groups/streams & electives (XI–XII groups, optional languages) — not every student in a section takes every subject | Support per‑student subject enrolment for exams/marks where needed | **Open — important** |
| D‑10 | Rounding of percentages / normalized marks | Round half up to 2 dp for display; store raw | Open |
| D‑11 | What students see when a submitted sheet is unlocked for correction | Keep showing last submitted values until resubmitted | Proposed |
| D‑12 | Rank ties and who is ranked (e.g. students with an absent subject) | Competition ranking (1,2,2,4); all enrolled students ranked once all subjects are final | Open |
| D‑13 | Who records behaviour ratings | Class Teacher (+ Admin) | Proposed |
| D‑14 | Request routing | Class Teacher of the student's section; Admin sees all | Proposed |
| D‑15 | "Permissions" management: fixed role map or Admin‑editable toggles; Class Teacher audit visibility | Fixed role map + scopes initially; extensible later | Open |
| D‑16 | Class Teacher student‑management scope (edit which fields? promote?) | View all + edit non‑protected contact fields; promotion proposed by CT, confirmed by Admin | Open |
| D‑17 | Can Class Teacher edit the class timetable or only view? | View only; Admin edits (avoids cross‑class teacher conflicts) | Open |
| D‑21 | Are sections defined per academic year or permanently? | Permanent sections with per‑year active flag | Open |
| D‑24 | Substitute / ad‑hoc teacher for a period (teacher absent) — who takes attendance? | Not in spec. Proposal: Class Teacher or Admin can mark; substitution feature only if requested | Open |
| D‑25 | Do internal/practical components have their own pass marks? | Configurable per component | Open |
| D‑26 | Leave entered after a subject teacher already marked `A` | Class Teacher's L replaces A, audited | Proposed |

## Pending inputs from the user

- Official school logo file (do not create a placeholder).
- School address, contact details, and signatory names/titles for PDFs.
- Current class/section list, subject list and period timings (for Phase 4 configuration — entered as data, not code).
