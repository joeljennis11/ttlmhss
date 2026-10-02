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
| students.view | ✅ | ✅ *scoped* | (✅) | ✅ *self* |
| students.create | ✅ | — | — | — |
| students.edit | ✅ | — | ✅ *own class* ⚠ D‑16 | — |
| students.promote | ✅ | — | — ⚠ D‑16 | — |
| teachers.view / create / edit | ✅ | — | — | — |
| timetable.view | ✅ | ✅ | (✅) | ✅ *own class* |
| timetable.manage | ✅ | — | — ⚠ D‑17 | — |
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

**Permission model decision (D‑15):** grants are **code‑defined and version‑controlled**, not Admin‑editable data. Changing a grant is a reviewed code change with tests. Admin‑editable permission toggles remain possible later without changing how features check permissions.

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
