# Permissions — TTLMHSS

Role‑based access control **plus record‑level scope**. Implemented in Phase 2; individual features use it from their own phases. **All checks are enforced by the API.** The web app only hides what the API would refuse anyway.

Source of truth in code:
- permission catalogue — `packages/shared/src/auth.ts` (`PERMISSIONS`)
- role grants — `apps/api/src/core/auth/role-permissions.ts`
- scope rules — `apps/api/src/core/auth/authorization.service.ts`

---

## 1. Roles

| Role | Stored? | How a user gets it |
|---|---|---|
| ADMIN | `users.role` | Account created as Admin (first one via `pnpm account create-admin`) |
| TEACHER | `users.role` | Teacher account (created by Admin from Phase 5) |
| CLASS_TEACHER | **No — derived** | A TEACHER with an **ACTIVE** class‑teacher assignment in the **CURRENT** academic year |
| STUDENT | `users.role` | Student account (created on admission from Phase 5) |

- Exactly these four. **No Parent role, no public registration.**
- **Class Teacher is not a separate account or login.** A class teacher keeps `TEACHER` and gains `CLASS_TEACHER` (`roles: ["TEACHER","CLASS_TEACHER"]`). Remove or deactivate the assignment and the extra role and scope disappear on the user's **next request** — no re‑login needed.

## 2. Two layers on every protected request

1. **Permission** — may this *kind* of user attempt this action? (`resource.action` keys granted per role.)
2. **Scope** — is *this record* within the user's reach? (school‑wide, own class, own periods, self.)

Holding a permission is **never** enough on its own. E.g. TEACHER and STUDENT both hold `students.view`, but a student may only view themself and a class teacher only students currently enrolled in their section.

## 3. Permission catalogue and grants

Legend: ✅ granted · — not granted. CLASS_TEACHER grants are **added** to TEACHER grants and apply only within the assigned section(s).

| Permission | Admin | Teacher | + Class Teacher | Student |
|---|---|---|---|---|
| users.view / create / edit / delete / reset_password | ✅ | — | — | — |
| config.view | ✅ | ✅ | (✅) | — |
| config.manage | ✅ | — | — | — |
| permissions.manage *(Phase 4)* | ✅ | — | — | — |
| students.view | ✅ | ✅ *scoped* | (✅) | ✅ *self* |
| students.create | ✅ | — | — | — |
| students.edit | ✅ | — | ✅ *own class* ⚠ D‑16 | — |
| students.promote | ✅ | — | — (admin‑only since Phase 5, D‑16) | — |
| students.transfer / deactivate / delete *(Phase 5)* | ✅ | — | — | — |
| teachers.view / create / edit | ✅ | — | — | — |
| teachers.deactivate / delete *(Phase 5)* | ✅ | — | — | — |
| teacher_subjects.view *(Phase 5)* | ✅ | — | — | — |
| teacher_subjects.manage *(Phase 5)* | ✅ | — | — | — |
| class_teacher_assignments.view *(Phase 5)* | ✅ | — | — | — |
| class_teacher_assignments.manage *(Phase 5)* | ✅ | — | — | — |
| timetable.view | ✅ | ✅ *own + classes taught* | ✅ *+ own class* | ✅ *own class* |
| timetable.manage *(edit the draft)* | ✅ | — (ceiling: never) | — by default; grantable, then *own class only* (D‑17) | — |
| timetable.publish *(Phase 6: publish / discard draft)* | ✅ | — | — (ceiling: never) | — |
| attendance.view | ✅ | ✅ *scoped* | (✅) | ✅ *self* |
| attendance.mark (P/A) | ✅ | ✅ *own periods* | (✅) | — |
| attendance.manage (leave, cancel, whole day) | ✅ | — | ✅ *own class* | — |
| attendance.override (after lock) | ✅ | — | — | — |
| exams.view | ✅ | ✅ | (✅) | ✅ |
| exams.manage | ✅ | — | — | — |
| marks.view | ✅ | ✅ *scoped* | (✅) | ✅ *self, submitted only* |
| marks.enter / marks.submit | ✅ | ✅ *own subjects* | (✅) | — |
| marks.edit (unlock / correct after submit) | ✅ | — | ✅ *own class* | — |
| results.view | ✅ | ✅ *scoped* | (✅) | ✅ *self* |
| behaviour.view | ✅ | — ⚠ D‑13 | ✅ | ✅ *self* |
| behaviour.manage | ✅ | — | ✅ *own class* | — |
| achievements.view | ✅ | — | ✅ | ✅ *self* |
| achievements.manage | ✅ | — **(BR‑ACH‑01)** | ✅ *own class* | — |
| announcements.view | ✅ | ✅ | (✅) | ✅ |
| announcements.manage | ✅ | — | ✅ *own class* | — |
| requests.view | ✅ | — | ✅ *own class* | ✅ *own* |
| requests.create | — | — | — | ✅ |
| requests.handle | ✅ | — | ✅ *own class* ⚠ D‑14 | — |
| reports.view | ✅ | ✅ *scoped* | (✅) | ✅ *self* |
| reports.generate | ✅ | — | ✅ *own class* | — |
| audit.view | ✅ | — | — ⚠ D‑15 | — |

"(✅)" = already held through TEACHER. *Italic* notes are scope rules applied by services. ⚠ marks open decisions (docs/decisions.md); the conservative choice was taken until they are confirmed.

**Permission model (D‑15, updated in Phase 4):** the table above is the set of **built‑in defaults**, defined in code (`core/auth/role-permissions.ts`). Since Phase 4 an administrator can adjust the Teacher, Class Teacher and Student grants on the *Role permissions* page — see §8. Features still check permissions exactly the same way.

## 4. Scope rules (implemented)

| Principal | Student records | Section/class records |
|---|---|---|
| ADMIN | all | all |
| STUDENT | **only their own** `studentId` | only the section(s) they are actively enrolled in (current year) |
| CLASS_TEACHER | students **currently actively enrolled** in a section they are class teacher of | their own section(s) |
| TEACHER only | **none yet** | **none yet** |

- **Teaching scope** (a subject teacher's sections/periods) comes from the **published timetable** and is added in **Phase 6**. Until then a plain teacher has no record‑level scope, so scope checks **deny** — the safe default.
- A STUDENT account is self‑scoped **even if other data were wrongly attached to it**.
- Scope is read from the database on every request (assignments, enrolments), so changes apply immediately.
- Out‑of‑scope access returns **403 FORBIDDEN** ("You do not have access to this record.").

## 5. How features enforce it (pattern for later phases)

```ts
// Route: authenticate + permission (deny by default; no route without `access`)
defineRoute({
  method: 'GET',
  url: '/students/:studentId',
  access: requires('students.view'),
  schema: { params: StudentParams },
  handler: ({ params, principal }) => students.getProfile(principal, params.studentId),
});

// Service: repeat the permission check and apply scope before touching data
async getProfile(principal: Principal | null, studentId: string) {
  const user = this.authz.authorize(principal, 'students.view');   // 401 / 403
  await this.authz.checkStudentScope(user, studentId);              // 403 if out of scope
  return this.repos.students.findProfile(studentId);
}
```

- **Student endpoints** like "my results" must take the student id from `principal.studentId`, never from the URL or body.
- **List endpoints** filter by scope in the query (e.g. only sections in `principal.classTeacherOf`), never fetch‑all‑then‑filter.
- Available guards on `AuthorizationService`: `authorize(principal, permission?)`, `checkStudentScope`, `canAccessStudent`, `checkSectionScope`, `canAccessSection`, `isClassTeacherOf`, `isAdmin`, `checkSelfOrAdmin`.

## 6. Request pipeline (enforcement order)

1. CSRF origin check on POST/PUT/PATCH/DELETE (foreign `Origin` or `Sec-Fetch-Site: cross-site` → 403).
2. Route declares `access` — missing → 500, never exposed.
3. **Authenticate**: session cookie → session valid (not revoked, not past absolute expiry, used within idle timeout) → user **ACTIVE** → has a credential → principal built with roles, permissions, class‑teacher and enrolment scope.
4. Protected route without principal → **401**.
5. Temporary password in use and the route is not `allowDuringPasswordChange` (`/auth/me`, `/auth/change-password`; logout is public) → **403 PASSWORD_CHANGE_REQUIRED**.
6. Route permission not held → **403**.
7. Handler → service → `authorize` + scope checks → **403** when out of scope.

## 7. Account lifecycle rules
- Inactive accounts cannot sign in, and an existing session stops working on the next request.
- Deactivation, password reset and password change revoke the user's sessions.
- There is no HTTP endpoint for creating accounts, resetting passwords or changing status yet: the services exist (`AccountCredentialsService`) and Admin screens/endpoints arrive in Phases 4–5, protected by `users.create`, `users.reset_password`, `users.edit`. Until then operators use the `pnpm account` CLI.

## 8. Administrator‑adjusted role permissions (Phase 4)

**What can be changed.** `PUT /admin/permissions/:role` for `TEACHER`, `CLASS_TEACHER`, `STUDENT` (requires `permissions.manage`, which only ADMIN holds). ADMIN is **not editable** and always holds every permission, so nobody can lock the school out of its own settings.

**Ceilings — no privilege escalation.** Every permission has a fixed ceiling in `@ttlmhss/shared` (`PERMISSION_INFO[p].grantableTo`): the only non‑admin roles that may ever hold it.

| Ceiling | Permissions |
|---|---|
| Administrators only (never grantable) | `users.*`, `config.manage`, `permissions.manage`, `students.create`, `students.promote`, `students.transfer`, `students.deactivate`, `students.delete`, `teachers.create`, `teachers.edit`, `teachers.deactivate`, `teachers.delete`, `teacher_subjects.manage`, `class_teacher_assignments.manage`, `attendance.override`, `exams.manage` |
| Class Teacher only | `students.edit`, `timetable.manage`, `attendance.manage`, `marks.edit`, `achievements.manage` (BR‑ACH‑01), `announcements.manage`, `requests.handle`, `audit.view` |
| Teacher and Class Teacher | `teachers.view`, `teacher_subjects.view`, `class_teacher_assignments.view`, `attendance.mark`, `marks.enter`, `marks.submit`, `behaviour.manage`, `reports.generate` |
| Student only | `requests.create` |
| Any role | the remaining `*.view` permissions |

The ceiling is enforced twice: a save that includes anything above it is **rejected** (400, nothing stored), and the runtime table is **clipped** to the ceiling when permissions are evaluated, so even a row edited directly in the database cannot grant more. A test checks that every built‑in default sits inside its ceiling.

**Storage.** `role_permission_overrides` (role, permission, GRANT/REVOKE, updated_by, updated_at) — only the *differences* from the defaults. Effective = (defaults ∪ grants − revokes) ∩ ceiling. Saving the defaults removes all rows for the role.

**When it takes effect.** `RolePermissionService` caches the table for 30 s and is invalidated on save, so changes apply to the **next request** in the same API process. With several API processes, others pick it up within 30 s.

**Audit.** Every save writes `config.permissions.updated` with the previous and new overrides.

**Scope rules are unchanged.** A granted permission still only says *what kind* of action is allowed; services keep applying scope (own periods, own class, self). Class Teacher grants still only apply within the assigned section.

**User‑specific permissions** are **not** implemented: there is no user‑management screen yet (accounts are created in Phase 5), and the spec asks for them only "if supported". The same override + ceiling design can be extended per user once Phase 5 exists.

**Phase 4 configuration endpoints** (`/api/v1/admin/...`) all require `config.manage` — reads included, because the screens show draft structure — except `/admin/permissions*`, which require `permissions.manage`. Every service method re‑checks the permission (`ConfigService.authorize`).

## 9. Student & teacher management (Phase 5)

Endpoints under `/api/v1/admin/students|promotions|teachers|class-teachers` use the permissions above; every service method re‑checks them (`PeopleService.authorize`).

| Action | Permission | Scope applied by the service |
|---|---|---|
| Student list | `students.view` | Admin: whole school. Class Teacher: only their own section(s) in that year. Anyone else: 403 (there is no school‑wide list for teachers or students) |
| Student detail | `students.view` | `checkStudentScope` (admin; class teacher of the student's section; the student themself) |
| Edit student details | `students.edit` | `checkStudentScope` (so a class teacher may only edit their own students — the CT default grant, D‑16) |
| Admit | `students.create` (+ `users.create` for the account) | admin‑only |
| Change class / place in class | `students.transfer` | admin‑only |
| Promote / record outcome | `students.promote` | admin‑only |
| Deactivate / reactivate | `students.deactivate` | admin‑only |
| Delete (unused records only) | `students.delete` | admin‑only |
| Issue temporary password | `users.reset_password` | admin‑only |
| Teacher list / detail | `teachers.view` (+ `teacher_subjects.view`, `class_teacher_assignments.view` to include those parts) | — |
| Add / edit / (de)activate / delete teacher | `teachers.create` / `teachers.edit` / `teachers.deactivate` / `teachers.delete` | admin‑only |
| Teacher → Subject | `teacher_subjects.manage` | admin‑only |
| Class teacher board / assign / end | `class_teacher_assignments.view` / `.manage` | admin‑only |

**Role assignment is fixed by the workflow:** admission always creates a `STUDENT` account and "Add teacher" always a `TEACHER` account; there is no role field (an extra `role` in the request is ignored — tested). Administrator accounts are created only by the server CLI. Class Teacher is not a role anyone is given: it is derived on each request from an ACTIVE class‑teacher assignment in the current year, so assigning, replacing or ending an assignment changes the teacher's scope on their next request.

**Web screens** (Students, Teachers, Class teachers, Promotion) are shown to users holding the admin‑only management permissions; the API enforces the same rules independently.

## 10. Timetable (Phase 6)

| Action | Who | Enforced by |
|---|---|---|
| See the year list, class/teacher timetables | `timetable.view` + scope below | route + `TimetableViewService` |
| Edit the draft (create / edit / move / remove lessons, start a draft) | `timetable.manage`: administrators everywhere; a class teacher **only in sections they are class teacher of** (current year), and only if the administrator grants it (default: not granted, D‑17) | route + `TimetableServiceBase.checkManageSection` on **every** operation (both the section of a new lesson and the section of an existing one) |
| Publish, discard the draft | `timetable.publish` — administrators only; ceiling NONE, so it can never be granted to a teacher or class teacher | route + service |

View scope (`timetable.view`):
- **Administrator** — every section and every teacher.
- **Teacher** — their own timetable (`/timetable/me`; another teacher's → 403) and the class timetables of sections they teach in the **published** timetable of that year.
- **Class teacher** — additionally the section(s) they are class teacher of.
- **Student** — their own placement's timetable (`/timetable/students/:id` with `checkStudentScope`; another student → 403). No student page yet (portal: Phase 9).
- Lessons on a date (`/timetable/lessons`) — a teacher sees only their own; an administrator may name any teacher.

Draft data is visible only to holders of `timetable.manage` (scoped as above); every view for everyone else reads the published version.

## 11. Attendance (Phase 7)

| Permission | Default holders | Ceiling | Used for |
|---|---|---|---|
| `attendance.view` | Admin, Teacher, Class Teacher, Student | all | open registers / views — always narrowed by scope below |
| `attendance.mark` | Admin, Teacher (+ Class Teacher) | staff | save a register (P / A / -) |
| `attendance.manage` | Admin, Class Teacher | Class Teacher | whole class, any period, L and C, multi‑period student day |
| `attendance.override` | Admin | **none** (administrators only) | change locked attendance, with a reason |

Scope (server‑side, from the signed‑in user — never from request ids):
- **Subject teacher** — only the register of **their own published lesson** for that date + period + section (resolved from the timetable in force that day, or the saved register's snapshot). Another period, another class, another teacher's lesson → 403. Body fields such as `teacherId`, `subjectId` or `classId` are ignored; a student not placed in that section is refused. They set P / A / - only and see L / C as read‑only.
- **Class teacher** — every register, the class day, student days, multi‑period L / C and class totals of the section(s) they are class teacher of **in that academic year**; nothing for other classes.
- **Administrator** — everything, including the paginated register search; locked dates need an explicit override with a reason.
- **Student** — `GET /attendance/me` (and `/attendance/students/:own id`) only; another id → 403 without revealing whether it exists; never writes.
- **Cutoff** — after the configured cutoff the register is read‑only for teachers and class teachers, whatever the URL.
