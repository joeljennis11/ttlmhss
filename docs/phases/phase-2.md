# Phase 2 — Authentication + RBAC

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting explicit Phase 3 instruction.

## Starting state
Phase 1 foundation as recorded in phase-1.md (verified: clean git tree at the Phase 1 commit; 87 tests passing). The access boundary existed but was wired fail‑closed with no authentication.

## Architecture decisions
| Decision | Choice | Why |
|---|---|---|
| Session vs token (D‑18) | Server‑side sessions, opaque token in an HttpOnly cookie, only an HMAC of it stored | Same‑origin SPA + existing DB; gives real logout, instant deactivation and instant scope changes. No JWT library needed. |
| Hashing | Argon2id via `@node-rs/argon2` (OWASP parameters) | Phase‑0 recommendation; vetted library with prebuilt binaries |
| Credentials storage | New `user_credentials` table, not columns on `users` | Hashes can never leak through ordinary user queries; table‑level CHECKs; clean rollback |
| Permissions (D‑15) | Code‑defined catalogue + role grants; no permission tables | Reviewed, tested changes; no premature admin UI; can evolve later |
| Class Teacher | Derived effective role from ACTIVE assignment in CURRENT year, resolved per request | Spec: a Teacher with extra scope, not a separate account |
| Abuse protection | `@fastify/rate-limit` per IP + in‑memory per‑username lockout | Established middleware + simple, enumeration‑safe lockout |
| CSRF | SameSite=Lax + JSON‑only bodies + Origin/Sec‑Fetch‑Site check | Layered defence suited to cookie auth |
| First Admin | Operator CLI `pnpm account create-admin` | No public registration allowed |

No architectural rewrite: Phase 1's `Authenticator` / `AccessPolicy` interfaces, access hook, route convention, data layer, migrations and audit recorder were extended, not replaced. No database provider change.

## What was implemented
**Shared (`packages/shared/src/auth.ts`)** — effective roles (ADMIN, TEACHER, CLASS_TEACHER, STUDENT), password status, the permission catalogue (38 keys incl. users.*, students.*, teachers.*, timetable.*, attendance.*, marks.*, reports.*), username/password schemas, password policy, login and change‑password request schemas, `AuthUser` DTO; new error codes `PASSWORD_CHANGE_REQUIRED`, `TOO_MANY_REQUESTS`.

**Database** — migration `0003_authentication`: `user_credentials`, `sessions`. Repositories: `UserAccountRepository`, `CredentialRepository`, `SessionRepository`, `AuthScopeRepository` (Kysely implementations, tested on SQLite and PostgreSQL).

**API**
- Config: `SESSION_SECRET` (required in production), session idle/absolute timeouts, `COOKIE_SECURE`, `TRUST_PROXY`, login rate limit and lockout settings.
- `core/auth`: richer `Principal` (authenticated‑user context), `requires(permission)`, role → permission map, `AuthorizationService` (authorize + student/section/self scope guards), access hook with the temporary‑password gate.
- `core/http`: per‑route rate limits; CSRF origin check. `text/plain` body parser removed.
- `modules/auth`: Argon2 hasher, session tokens + temporary passwords, `SessionManager`, `SessionAuthenticator`, cookie policy, `LoginThrottle`, `AuthService` (login, logout, me, change password), `AccountCredentialsService` (create account, issue temporary password, activate/deactivate — for later Admin phases and the CLI).
- Endpoints: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`.
- `composition.ts` wires production dependencies; `scripts/accounts.ts` CLI (`create-admin`, `reset-password`, `deactivate`, `activate`).
- Audit events for sign‑in success/failure/block, sign‑out, password change/failure, temporary password issue, account create/activate/deactivate.

**Web (minimal, unstyled beyond tokens)** — `AuthProvider` (session from `/auth/me`), `AuthGate` (protected‑route behaviour), sign‑in page, mandatory change‑password page, minimal signed‑in page with sign‑out, `SystemStatus` line. The Phase 1 `FoundationStatus` page was replaced by these (its health check lives on as `SystemStatus`).

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (lint, format, typecheck, tests) | clean — **146 tests in 9 files** (Phase 1: 87) |
| Data‑layer suite incl. new auth repositories | passes on SQLite **and** PostgreSQL (PGlite) |
| Mutation check | temporarily breaking student self‑scope and the temporary‑password gate made the relevant tests fail (then restored) |
| `pnpm build` | shared, api, web build |
| Manual dev run (via Vite proxy, cookie jar, browser‑like Origin) | CLI admin creation; duplicate refused; anonymous `/me` 401; wrong password and unknown user give identical errors; temp‑password sign‑in sets HttpOnly SameSite=Lax cookie; forced change; foreign Origin blocked; change rotates session; logout revokes; temp password no longer works, new one does; health/branding unchanged |
| Dev log inspection | no passwords present |
| Production build | refuses to start without `SESSION_SECRET` (exit 1); with it, issues `__Host-` Secure HttpOnly cookie; CORS only for configured origin; audit rows written; temporary password absent from logs |

Not done: visual check of the screens in a browser (the browser tool here blocks localhost).

## Files added / changed (main)
- Added: `packages/shared/src/auth.ts`, `packages/shared/test/auth.test.ts`; `apps/api/src/composition.ts`; `core/auth/{authorization.service,role-permissions,scope.repository}.ts`; `core/http/origin-check.ts`; `modules/auth/*`; `data/kysely/migrations/0003_authentication.ts`; `data/kysely/repositories/{user-account,session,auth-scope}.repository.ts`; `scripts/accounts.ts`; tests `authentication.test.ts`, `authorization.test.ts`, `support/auth-fixtures.ts`; web `features/auth/*`, `features/system/SystemStatus.tsx`.
- Changed: `shared` api‑contract (error codes) and controlled‑values (exported helper); `config/config.ts`; `core/auth/access.ts`, `access-hook.ts`; `core/errors/*`; `core/http/routes.ts`; `app.ts`, `app-dependencies.ts`, `modules.ts`, `server.ts`; `data/data-store.ts`, `kysely-data-store.ts`, `database-schema.ts`, migrations index; `.env.example`; test harness and Phase 1 tests (new Principal shape, third migration); web `App.tsx`.
- Removed: web `features/foundation/*` (superseded).

## Known limitations
- Login lockout state is in memory (single API process).
- Dev/test without `SESSION_SECRET` sign everyone out on restart (warned at startup).
- No Argon2 rehash‑on‑login when parameters change.
- Plain subject teachers have no record scope until the timetable (Phase 6).
- No self‑service password reset (D‑33): the office issues temporary passwords.
- No HTTP endpoints for account administration yet (services exist; Admin UI in Phases 4–5).

## What Phase 3 needs to know
- Sign‑in, change‑password and signed‑in screens exist and are **functional only**; Phase 3 should restyle them (logo, branding, shell) without changing `auth-context.tsx` behaviour or bypassing `AuthGate`.
- Use `useAuth().state.user.roles/permissions` (and `can()`) to decide what navigation to show — as UX only.
- Every new API route must declare `access` (`requires('…')`) and services must call `authorization.authorize(...)` + a scope check.
- Create a local admin with `pnpm account create-admin <username>`; set `SESSION_SECRET` in `apps/api/.env.development.local` to keep sessions across restarts.
- D‑27 (frontend libraries such as a router) should be decided at the start of Phase 3.
