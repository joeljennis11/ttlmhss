# Permissions — TTLMHSS (Conceptual Model)

Conceptual RBAC + scope model. Implementation arrives in Phase 2 (framework) and is extended feature‑by‑feature in later phases. **All checks are enforced in the backend**; the frontend only hides/disables what the backend would refuse anyway.

---

## 1. Model: role + scope

A permission check answers: *can this **actor** perform this **action** on this **resource** within this **scope**?*

- **Role** — what kind of user (Admin, Teacher, Student). Stored on the account.
- **Assignments** — data that grant scope:
  - *Teacher‑subject* (Teacher → Subject)
  - *Timetable assignment* (Teacher + Subject + Class‑Section + Day + Period) — grants subject‑teacher scope
  - *Class‑teacher assignment* (Teacher + Class‑Section + Academic Year) — grants class‑teacher scope
  - *Enrolment* (Student + Class‑Section + Academic Year) — defines the student's own scope
- **Class Teacher is not a separate account role.** It is a Teacher whose effective permissions are widened by a class‑teacher assignment. A teacher can be a subject teacher for many sections and class teacher for one, at the same time.

Effective scopes for an authenticated user:

| Scope | Who | Covers |
|-------|-----|--------|
| `school` | Admin | Everything |
| `class:<sectionId>` | Class Teacher | Their assigned class‑section in the current year |
| `teaching:<sectionId,subjectId>` | Teacher | Pairs derived from the published timetable |
| `period:<sectionId,day,period>` | Teacher | Their own timetable slots |
| `self:<studentId>` | Student | Their own records only |

## 2. Permission keys (proposed naming)

`resource.action`, e.g. `attendance.mark`, `attendance.override`, `marks.unlock`. Roles map to keys; scope is checked separately by policy functions. Admin may later get configurable fine‑grained toggles ("permissions" in the spec) — **⚠ Open (D‑15)** whether this is a fixed role map or Admin‑editable.

## 3. Matrix

Legend: ✅ full · 🔷 within own scope only · 👁 view only · ❌ none

| Capability | Admin | Teacher (subject) | Class Teacher (own class) | Student (self) |
|---|---|---|---|---|
| School config, academic years, periods | ✅ | ❌ | ❌ | ❌ |
| Classes, sections, subject master | ✅ | 👁 | 👁 | ❌ |
| Exam, grade, normalization, weightage config | ✅ | 👁 | 👁 | ❌ |
| Behaviour categories/labels config | ✅ | ❌ | 👁 | ❌ |
| Add/admit/edit/deactivate students | ✅ | ❌ | 🔷 view + limited edit **⚠ D‑16** | 👁 own profile |
| Promote/transfer students | ✅ | ❌ | 🔷 propose/execute **⚠ D‑16** | ❌ |
| Add/edit teachers, assign subjects, assign class teachers | ✅ | ❌ | ❌ | ❌ |
| Reset passwords / deactivate accounts | ✅ | ❌ | ❌ | ❌ |
| Edit timetable (draft/save/publish) | ✅ | ❌ | 🔷 view; edit **⚠ D‑17** | ❌ |
| View timetable | ✅ | 🔷 own | 🔷 own + class | 🔷 own class |
| Mark attendance P/A | ✅ | 🔷 own periods, before cutoff | 🔷 any period of class, before cutoff | ❌ |
| Apply Leave / mark Cancelled | ✅ | ❌ | 🔷 | ❌ |
| Override locked attendance | ✅ (audited, reason) | ❌ | ❌ | ❌ |
| View attendance | ✅ | 🔷 own periods | 🔷 class | 🔷 self |
| Enter marks (draft/submit) | ✅ | 🔷 own subject‑sections | 🔷 own subjects (as subject teacher) | ❌ |
| Unlock submitted marks / correct | ✅ (audited) | ❌ | 🔷 class (audited) | ❌ |
| View marks/results | ✅ | 🔷 own subject‑sections | 🔷 whole class | 🔷 self, submitted subjects only |
| Behaviour ratings | ✅ | ❌ **⚠ D‑13** | 🔷 | 👁 self |
| Achievements manage | ✅ | ❌ | 🔷 | 👁 self |
| Annual report final remark | ✅ | ❌ | 🔷 | 👁 self |
| Announcements post | ✅ any audience | ❌ | 🔷 own class | ❌ |
| Announcements view | ✅ | 🔷 targeted | 🔷 targeted | 🔷 targeted |
| Requests create | ❌ | ❌ | ❌ | 🔷 self |
| Requests handle | ✅ | ❌ | 🔷 class | 👁 own requests |
| Reports & PDFs | ✅ | 🔷 own periods/subjects | 🔷 class | 🔷 self, available docs only |
| Audit log view | ✅ | ❌ | 🔷 class‑related **⚠ D‑15** | ❌ |

## 4. Enforcement rules

1. **Deny by default.** Every API route declares its required permission; routes without a declaration fail closed.
2. **Two checks per request:** role/permission (*may this kind of user do this?*) and scope/ownership (*is this record within their scope?*). Scope checks live in a policy layer the services call — not scattered in controllers or the UI.
3. **Never trust client‑supplied scope.** For students, the student ID comes from the session, never from the URL/body. For teachers, section/subject/period scope is resolved from assignments server‑side.
4. **Time‑aware rules** (attendance cutoff, marks lock, academic‑year read‑only) are part of the policy decision, not UI state.
5. **List endpoints filter by scope** at the query level — never fetch everything and filter in the client.
6. **Audit** every privileged or override action (attendance override, marks unlock/correction, promotion, account resets, config changes).
7. Deactivated accounts cannot authenticate; changing a user's assignments takes effect on their next request (no stale cached permissions beyond the request).
