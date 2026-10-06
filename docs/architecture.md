# Architecture — TTLMHSS

Status after **Phase 3**: the foundation (Phase 1), authentication + RBAC (Phase 2, §10) and branding, sign‑in and the application shell (Phase 3, §11) are **implemented and verified**. Items in §9 remain proposals. Open decisions live in [decisions.md](decisions.md); the database provider is still **not finalised** (D‑04).

---

## 1. Shape of the system

```
┌──────────────────────────┐   JSON over HTTP (/api/v1)   ┌──────────────────────────────────────────────┐
│ apps/web (React SPA)     │ ───────────────────────────▶ │ apps/api (Fastify)                           │
│  features → components   │                              │  access hook (authenticate → authorize)      │
│  lib/api-client (only    │ ◀─────────────────────────── │  routes: validate input → call ONE service   │
│  way to reach data)      │                              │  services: business rules                    │
└──────────────────────────┘                              │  repository INTERFACES (src/data)            │
          ▲                                               │        ↓ implemented by                      │
          │ types, schemas, controlled values             │  Kysely adapter (src/data/kysely) → database │
┌─────────┴────────────────┐                              │  audit recorder · error handler · logger     │
│ packages/shared          │ ─────────────────────────────┘                                              │
└──────────────────────────┘                              └──────────────────────────────────────────────┘
```

One deployable API + one static web client, in a pnpm monorepo. No microservices.

## 2. Technology — what was actually adopted

| Concern | Adopted | Notes |
|---|---|---|
| Language | TypeScript 6.0 (strict, `noUncheckedIndexedAccess`) | TS 7.x exists but typescript‑eslint supports `<6.1`; pinned `~6.0.3`. |
| Runtime | Node.js ≥ 22.12 (`.nvmrc` = 22) | |
| Repo | pnpm 10 workspaces: `apps/api`, `apps/web`, `packages/shared` | |
| Backend | Fastify 5, `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`, `@fastify/rate-limit` | cookie + rate limit added in Phase 2 |
| Password hashing | Argon2id via `@node-rs/argon2` (prebuilt native binding, no compile step) | Phase 2, see §10 |
| Validation | Zod 4, shared building blocks in `@ttlmhss/shared` | |
| Data access | **Kysely 0.29** query builder + migrations, behind repository interfaces | **Deviation from Phase 0** (was "Prisma or Drizzle") — see §8. |
| DB drivers | `better-sqlite3` (SQLite), `pg` (PostgreSQL) | Selected at runtime from `DATABASE_URL`; loaded lazily. |
| Frontend | React 19 + Vite 8, **React Router 8**, CSS custom‑property design tokens + CSS Modules, `lucide-react` icons, self‑hosted fonts (`@fontsource-variable` Public Sans + Source Serif 4) | D‑27: no Tailwind/Radix/TanStack Query — not needed for the shell; revisit when data‑heavy modules arrive |
| Browser tests | Vitest + jsdom + Testing Library (components); **Playwright** (end‑to‑end against the real API) | Phase 3 |
| Logging | Pino (Fastify built‑in); pretty output in development, JSON elsewhere | |
| Testing | Vitest 5 (projects: shared, api, web); PGlite for PostgreSQL tests | |
| Lint/format | ESLint 10 (flat config) + typescript‑eslint + react‑hooks, Prettier 3 | |

Not yet used (planned for later phases): PDF/Excel generation (Phase 11).

## 3. Repository layout (actual)

```
apps/
  api/
    src/
      server.ts              process entry: config → data store → schema check → listen → graceful shutdown
      app.ts                 buildApp(deps): Fastify factory (helmet, cors, request ids, error handling, access hook, modules)
      app-dependencies.ts    AppDependencies: config, dataStore, clock, hasher, sessions, throttle, authenticator, policy, authorization
      composition.ts         createAppDependencies(): wires the production implementations
      modules.ts             list of registered feature modules
      config/                env loading (.env precedence), Zod-validated AppConfig, DATABASE_URL parsing
      core/
        auth/                Principal, AccessRequirement/requires(), access hook, role → permission map,
                             AuthorizationService (permission + scope guards), AuthScopeRepository interface
        errors/              AppError hierarchy + the single error → HTTP mapper
        http/                defineRoute / registerRoutes convention (+ per-route rate limit), FeatureModule, CSRF origin check
        audit/               AuditLogRepository interface, AuditRecorder (redacts secrets)
        logging/             logger options + redaction paths
        utils/               Clock, id and timestamp helpers
      data/
        data-store.ts        DataStore / Repositories / SchemaManager INTERFACES (the data-access boundary)
        index.ts             composition root: openDataStore(config) → implementation
        kysely/              the ONLY code that touches the database
          connection.ts      SQLite / PostgreSQL dialect factory
          database-schema.ts table row types
          migrations/        versioned, portable migrations + DDL helpers
          repositories/      repository implementations
          db-errors.ts       driver error → AppError translation
          schema-manager.ts  migration runner
      modules/
        system/              GET /api/v1/health
        school/              GET /api/v1/school/branding (+ SchoolSettingsRepository interface)
        auth/                login/logout/me/change-password, sessions, hashing, throttle, account credentials
        config/              Phase 4 Admin configuration: ConfigService base, services, repository interfaces, /admin routes
        people/              Phase 5 students, enrolments, promotion, teachers, Teacher → Subject, class teachers
      scripts/db.ts          migrate / rollback / status CLI
      scripts/accounts.ts    create-admin / reset-password / activate / deactivate CLI
    test/                    config, HTTP foundation, data layer (SQLite + PostgreSQL), authentication, authorization;
                             support/ harness, auth fixtures, PGlite dialect
    .env.example .env.development .env.test
  web/
    src/
      main.tsx               providers: Router → Toasts → Branding → Auth → AppRoutes
      app/                   AppRoutes (routing), routes.tsx (SHELL_ROUTES: pages + menu), guards, page-meta
      brand/                 brand.ts (single fallback identity), BrandingProvider, SchoolLogo
      shell/                 AppShell, Sidebar, Header, UserMenu, navigation (role-aware filtering)
      pages/                 HomePage, AccountPasswordPage, NotFoundPage, ForbiddenPage
      features/auth/         auth-context, LoginPage, ForcedPasswordChangePage, ChangePasswordForm
      features/system/       SystemNotice (shown on sign-in only when the system is down)
      components/ui/         Button, TextField/PasswordField, Alert, Spinner, Loading/Empty/Error states,
                             ConfirmDialog, Toasts (ui.module.css)
      components/layout/     PageHeader, Panel
      features/admin/        Phase 4 School setup: admin-pages registry, AdminLayout, api.ts, pages/*, CategoryManager
      features/people/       Phase 5 Students, Teachers, Class teachers, Promotion (api.ts, pages/*, shared helpers)
      lib/                   api-client (+ auth-failure events), roles, use-media-query, use-resource, use-form-submit, format
      styles/                tokens.css (design tokens), base.css (fonts, reset)
    public/brand/            web copies of the official logo (generated; see §11)
    scripts/                 build-brand-assets.mjs
    test/                    component tests (jsdom) + navigation/role helpers
    e2e/                     Playwright end-to-end tests
    playwright.config.ts
assets/brand/                the OFFICIAL logo files (original + enhanced master), stored unmodified
packages/
  shared/src/                api-contract.ts, auth.ts (roles, permissions, password policy, auth DTOs),
                             controlled-values.ts, validation.ts, config.ts (Phase 4 schemas + shared rules),
                             permission-info.ts (labels, groups, per-role ceilings)
docs/                        this documentation
```

## 4. Boundaries (as implemented)

### Frontend
- Reaches data **only** through `lib/api-client.ts` (`/api/v1/...`), which validates payloads with shared Zod schemas and turns the error envelope into `ApiClientError` with a user‑safe message.
- ESLint forbids importing backend code into `apps/web`.
- Every async view has loading / error / success states (shared `LoadingState`, `ErrorState`, `EmptyState`).
- Design tokens and the shell are described in §11.

### API layer — route/controller convention
```ts
defineRoute({
  method: 'GET', url: '/school/branding',
  access: PUBLIC,                         // REQUIRED: deny by default
  schema: { params, query, body },        // Zod; all issues collected into one 400
  handler: ({ params, query, body, principal }) => service.method(...),
});
```
- Handlers return data; the framework wraps it as `{ "data": ... }` (or `{ data, meta }` via `paged()`).
- A **feature module** (`<feature>.module.ts`) builds its services from `AppDependencies` and lists its routes; it is added to `src/modules.ts` only when the feature is real.

### Request/response contract (`@ttlmhss/shared/api-contract`)
- Success: `{ "data": T, "meta"?: { page, pageSize, total } }`
- Error: `{ "error": { "code", "message", "details"?: [{ path, message }], "requestId" } }`
- Codes: `VALIDATION_ERROR 400`, `UNAUTHORIZED 401`, `PASSWORD_CHANGE_REQUIRED 403`, `FORBIDDEN 403`, `NOT_FOUND 404`, `CONFLICT 409`, `TOO_MANY_REQUESTS 429`, `INTERNAL_ERROR 500`, `SERVICE_UNAVAILABLE 503`.
- Every response carries `x-request-id` (server‑generated; client values ignored) which also appears in logs.

### Error handling
- Services/repositories throw `ValidationError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`, `ForbiddenError`, `PasswordChangeRequiredError`, `TooManyRequestsError`, `ServiceUnavailableError`, `InternalError`.
- One error handler maps them. Unknown errors and `InternalError` → 500 with a generic message; the real error is logged only. Malformed JSON / oversized bodies → 4xx without internals.

### Authentication & authorization boundary
- `Authenticator.authenticate(request) → Principal | null` and `AccessPolicy.isAllowed(principal, requirement)` are interfaces injected via `AppDependencies`; production wiring is `SessionAuthenticator` + `permissionPolicy` (§10).
- A global `onRequest` hook enforces each route's declared `access`: public → allowed; otherwise no principal → 401, temporary password → 403 PASSWORD_CHANGE_REQUIRED, permission missing → 403; a route **without** a declaration → 500 (never exposed).
- Record‑level scope is checked in services through `AuthorizationService` (docs/permissions.md §5).

### Service / business‑logic boundary
- Services receive repository interfaces, `Clock`, and `AuthorizationService`. They never import Kysely, SQL or drivers — **enforced by ESLint** (`no-restricted-imports` on `apps/api/src/**` except `src/data/kysely/**`, `src/data/index.ts` and the CLI).

### Data‑access boundary
- `DataStore` exposes `repositories`, `transaction(work)` (unit of work: all writes, including audit entries, commit or roll back together), `ping()`, `schema` (migrations) and `close()`.
- Repository implementations translate driver errors: unique / foreign‑key / restrict violations → `ConflictError`; CHECK / NOT NULL → `InternalError` (validation should have caught it); connection failures → `ServiceUnavailableError`.
- Repositories so far: `SchoolSettingsRepository`, `AuditLogRepository` (Phase 1); `UserAccountRepository`, `CredentialRepository`, `SessionRepository`, `AuthScopeRepository` (Phase 2). Feature repositories arrive with their features.

### Audit
- `AuditRecorder(repository, clock).record(event, { actorUserId, requestId })` writes `audit_logs` rows; keys matching password/secret/token/hash are redacted. Construct it with the repositories of the current transaction. Events emitted so far: authentication and account events (§10).

### Configuration
- **Deployment configuration** (`apps/api/src/config`): Zod‑validated at startup; invalid config stops the process listing every problem without echoing values. Precedence: real env → `.env.<mode>.local` → `.env.<mode>` → `.env`. Modes: development, test, production. Production additionally rejects in‑memory databases and requires `CORS_ORIGINS` and `SESSION_SECRET`. `.env.development` / `.env.test` are committed (no secrets); `.env`, `*.local`, `.env.production` are git‑ignored.
- **School configuration** is data in the database (`school_settings`, classes, sections, subjects, periods, …), never hard‑coded. Admin editing arrives in Phase 4.

### Logging
- Pino via Fastify; request/response lines include the request id. Redaction for authorization/cookie headers and password/token fields. Level from `LOG_LEVEL` (tests: silent).

## 5. Startup & schema safety
`server.ts` loads config → opens the data store → **refuses to start (exit 1) if migrations are pending** → listens → closes HTTP and DB cleanly on SIGINT/SIGTERM. Migrations are applied explicitly with `pnpm db:migrate` (or `db:migrate:prod` against compiled code), never implicitly at startup.

## 6. Testing approach (implemented)

| Suite | Covers |
|---|---|
| `packages/shared/test` | controlled values (attendance codes exactly `- P A L C`, roles, rating range), validation building blocks |
| `apps/api/test/config.test.ts` | defaults, problem reporting, secret non‑echo, production rules, `.env` precedence, URL parsing |
| `apps/api/test/http-foundation.test.ts` | health (200/503), branding, security headers/CORS, 404 envelope, validation envelope, error mapping & internal‑error masking, pagination envelope, access boundary (401/403/allowed/undeclared), real TCP listen |
| `apps/api/test/data-layer.test.ts` | runs **twice — SQLite and PostgreSQL (PGlite)**: migrate/rollback/re‑apply, repositories, transactional rollback incl. audit, unique/FK/RESTRICT/CHECK constraints, partial unique indexes, academic‑history rules |
| `apps/api/test/authentication.test.ts` | Argon2id hashing/verification, login (valid, identical generic failures for unknown/wrong/inactive/no‑password), malformed input, cookie flags, token stored only as HMAC, `/auth/me`, logout revocation, idle + absolute expiry, deactivation mid‑session, temporary‑password enforcement and change flow, session rotation, password reset, per‑username lockout, per‑IP rate limit, CSRF origin check, audit content, no secrets in logs |
| `apps/api/test/authorization.test.ts` | via real sessions: 401 for anonymous; Admin; plain Teacher (no scope yet, no achievements); Class Teacher scope limited to own section and following the assignment immediately; Student self‑scope; role‑permission map invariants; guard unit tests |
| `apps/web/test/api-client.test.ts` | envelope parsing, error/network/invalid‑payload handling |
| `apps/web/test/app.test.tsx` (jsdom) | routing guards; permission‑ and role‑gated pages via test‑only routes (no‑access page, menu entries hidden, typed URL still gated); temporary‑password routing; sign‑in validation, network failure, system‑down notice, start‑up error with retry; account menu, sign‑out, Escape/focus |
| `apps/web/test/navigation.test.ts` | navigation filtering and role display helpers |
| `apps/web/e2e/auth-shell.spec.ts` (Playwright, real API + throwaway DB) | redirect to sign‑in and back; official crest served; validation, loading, generic failures; show/hide password; signed‑in users leave /login; each role sees its role and only existing pages; 404 in shell; temporary‑password flow cannot be bypassed; sign‑out invalidates the server session (cookie replay refused); session ended elsewhere → sign‑in with explanation; desktop/tablet/mobile layouts, drawer keyboard behaviour, no horizontal overflow |

Test fixtures are synthetic and live only in throwaway in‑memory databases. No feature tests exist for features that are not built. Every later business rule should be traceable to a test by its BR‑ID.

## 7. Commands

| Command | What it does |
|---|---|
| `pnpm install` | install all workspace dependencies |
| `pnpm db:migrate` | apply pending migrations to the database in `DATABASE_URL` (dev default: `apps/api/data/ttlmhss.dev.sqlite`) |
| `pnpm db:status` / `pnpm db:rollback` | list migrations / revert the latest one |
| `pnpm dev` | API on :3000 (watch) + web on :5173 (proxying `/api` to the API) |
| `pnpm dev:api` / `pnpm dev:web` | one side only |
| `pnpm build` | build shared → api (`apps/api/dist`) → web (`apps/web/dist`) |
| `pnpm start` | run the built API (`node dist/server.js`; set `NODE_ENV=production` and real env vars) |
| `pnpm --filter @ttlmhss/api db:migrate:prod` | run migrations with the compiled CLI |
| `pnpm account create-admin <username>` | create an Administrator with a one‑time temporary password (also `reset-password`, `deactivate`, `activate`; compiled: `account:prod`) |
| `pnpm test` / `pnpm test:watch` | all test suites |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm format:check` | static checks |
| `pnpm check` | lint + format check + typecheck + tests |
| `pnpm --filter @ttlmhss/web test:e2e` | browser end‑to‑end tests (starts its own API + web server on ports 3101/5174 with a throwaway database; needs Playwright's Chromium or `CHROMIUM_PATH`) |
| `pnpm --filter @ttlmhss/web brand:assets` | regenerate the web logo/favicons from the official logo |

## 8. Deviations from Phase 0 (and why)

1. **Kysely instead of Prisma/Drizzle (D‑03).** Prisma pins one provider per schema file and depends on downloaded engine binaries; Drizzle needs a separate table definition per dialect (`sqliteTable` vs `pgTable`). Kysely lets one set of migrations and one set of repositories run unchanged on SQLite and PostgreSQL — which the test suite proves — so the provider stays genuinely replaceable. Trade‑off: row types are written by hand (`database-schema.ts`) and kept honest by the data‑layer tests.
2. **Portable storage conventions:** text UUID ids generated by the app, ISO‑8601 text timestamps, `YYYY-MM-DD` dates, `HH:MM` times, text + CHECK for controlled values, `status` columns instead of booleans. Chosen so both providers behave identically; if PostgreSQL is chosen, native `timestamptz`/`uuid` types can be adopted in a later migration.
3. **Frontend libraries deferred:** Tailwind, Radix, React Router and TanStack Query were proposed but are not installed because Phase 1 has a single status page. To be confirmed in Phase 3 (D‑27).
4. **Feature tables deferred to their phases** — see [database-design.md](database-design.md) §5.

## 9. Still proposals (not implemented)
- PDF via HTML/CSS + headless Chromium; Excel via ExcelJS (D‑19, Phase 11).
- Hosting target (D‑20).

## 10. Authentication & RBAC (Phase 2)

### Mechanism: server-side sessions in HttpOnly cookies (D‑18)
Chosen over JWTs because the web app and API are same‑origin (the dev proxy / a reverse proxy in production), the database is already there, and the requirements need **real logout, immediate deactivation and immediate scope changes** — all natural with server‑side sessions and awkward with self‑contained tokens.

| Aspect | Implementation |
|---|---|
| Token | 256 random bits (base64url, 43 chars), only in the cookie |
| Storage | `sessions.token_hash = HMAC‑SHA256(SESSION_SECRET, token)` — a database leak yields no usable session |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Expires` = absolute expiry; `Secure` + `__Host-` prefix when `COOKIE_SECURE` (default in production) |
| Lifetime | idle timeout (default 120 min, sliding; `last_seen_at` written at most once a minute) + absolute timeout (default 12 h) |
| Validation per request | not revoked · before absolute expiry · within idle timeout · user ACTIVE · credential present |
| Logout | revokes the session row and clears the cookie; the old cookie value is useless afterwards |
| Fixation | a new session is issued on every sign‑in and on password change |
| Revocation | password change → all sessions revoked, new one issued; password reset / deactivation → all sessions revoked |
| Housekeeping | a user's expired/revoked session rows are deleted at their next sign‑in (events remain in the audit log) |

### Passwords
- **Argon2id** (`m=19456 KiB, t=2, p=1`, OWASP baseline), PHC strings, unique salts. Verification never throws on bad input.
- Hashes live in `user_credentials`, separate from `users`; no API response or log contains them.
- Policy for new passwords (shared, enforced by the API): 8–128 characters, a letter and a digit, no leading/trailing space, not a common password, must not contain the username, must differ from the current one, confirmation must match.
- **Temporary passwords**: 12 characters from a look‑alike‑free alphabet (CSPRNG), stored hashed with status `TEMPORARY`; shown once to the issuer. A `TEMPORARY` user can sign in but only `/auth/me`, `/auth/change-password` and logout work until it is changed — enforced in the access hook and again in `AuthorizationService.authorize`.

### Sign-in protection
- **Generic failure**: unknown user, wrong password, inactive account and missing password all return the same `401 Invalid username or password.` A dummy Argon2 verification runs for unknown users so timing does not reveal account existence. The specific reason goes to the audit log only.
- **Per‑IP rate limit** on `/auth/login` and `/auth/change-password` (`LOGIN_RATE_LIMIT_PER_MINUTE`, default 10) via `@fastify/rate-limit` → 429 `TOO_MANY_REQUESTS`.
- **Per‑username lockout** after `LOGIN_MAX_FAILED_ATTEMPTS` (5) failures within `LOGIN_LOCKOUT_MINUTES` (15) → 429 even with the right password; unknown usernames are tracked identically (no enumeration). Change‑password has its own per‑user lockout for wrong current passwords.
- **CSRF**: SameSite=Lax cookie + JSON‑only bodies (`text/plain` parser removed) + Origin/Sec‑Fetch‑Site check on unsafe methods.
- `TRUST_PROXY` must only be enabled behind a known reverse proxy (otherwise clients could spoof their IP for rate limiting).

### Endpoints
| Method & path | Access | Purpose |
|---|---|---|
| `POST /api/v1/auth/login` | public, rate‑limited | `{username, password}` → sets cookie, returns `{ user }` |
| `POST /api/v1/auth/logout` | public (works with an expired session) | revokes session, clears cookie |
| `GET /api/v1/auth/me` | signed in (also during password change) | `{ user }` — the authenticated‑user DTO |
| `POST /api/v1/auth/change-password` | signed in (also during password change), rate‑limited | `{currentPassword, newPassword, confirmPassword}` → new cookie, `{ user }` |

The user DTO (`AuthUser`) contains id, username, display name, account role, effective roles, permissions, linked teacher/student id, class‑teacher sections and `mustChangePassword` — never hashes, tokens or secrets.

### Authenticated-user context (`Principal`)
Built on every request by `SessionAuthenticator`: `userId, username, displayName, accountRole, roles, permissions, teacherId, studentId, classTeacherOf, enrolledIn, mustChangePassword, sessionId`. Services receive it from the route (`ctx.principal`) — they never decode cookies.

### Audit events
`auth.login.succeeded`, `auth.login.failed` (with internal reason), `auth.login.blocked`, `auth.logout`, `auth.password.changed`, `auth.password.change_failed`, `auth.password.temporary_issued`, `account.created`, `account.activated`, `account.deactivated`. Audit data passes through redaction; passwords and tokens are never written.

### Account operations
`AccountCredentialsService` (create account with temporary password, issue temporary password, activate/deactivate) is ready for the Admin phases; it checks `users.create` / `users.reset_password` / `users.edit` when called by a signed‑in user. Today it is used by the `pnpm account` CLI (actor `system`), which is how the first Administrator is created — there is no public registration.

### Frontend
`AuthProvider` asks `/auth/me` on load; route guards render sign‑in, the mandatory password change, or the shell (§11). The browser never sees the session token.

### Known limitations
- Login throttle state is **in memory** (single API process). Multiple instances would need a shared store.
- Without `SESSION_SECRET` in development/test, a per‑process secret is generated: everyone is signed out when the API restarts (a startup warning says so).
- Argon2 parameters are fixed in code; a "rehash on next login when parameters increase" step is not implemented yet.
- A plain subject teacher has no record‑level scope until the timetable exists (Phase 6).

## 11. Branding, sign-in and application shell (Phase 3)

### Brand assets
| What | Where | Notes |
|---|---|---|
| Official logo — master (Phase 4) | `assets/brand/ttlmhss-logo-enhanced.jpg` (8000 px) | Enhanced file supplied with Phase 4, stored exactly as supplied (SHA‑256 checked). Never edited. The original `ttlmhss-logo-official.jpg` is kept for reference |
| Web logo | `apps/web/public/brand/ttlmhss-logo.webp` (512 px) | Generated by `brand:assets` — **resize only** |
| Favicon / home‑screen icon | `apps/web/public/brand/favicon-32.png`, `apple-touch-icon.png` | Generated the same way |
| Database reference | `school_settings.logo_path = /brand/ttlmhss-logo.webp` (migration 0004) | `GET /school/branding` returns it as `logoUrl` |
| Future PDFs (Phase 11) | read the enhanced master from `assets/brand/` | |

The crest is circular and fills its square image edge to edge, so the UI shows it with `border-radius: 50%` — this hides only the image's white corners, never part of the crest (`brand/SchoolLogo.tsx`). The school name and short name come from `GET /school/branding` via `BrandingProvider`; `brand/brand.ts` holds the one fallback copy used until that response arrives. Components never hard‑code the names.

### Colour and type system (`styles/tokens.css`)
- **Forest `#003300`**: sidebar, sign‑in identity panel, primary buttons, page titles, active states. Hover/pressed `#002600`; tints `#E7EFE5` (selected/subtle fills), `#F1F6F0` (hover on light).
- **Neutrals**: white surfaces, cool green‑grey canvas `#F5F7F4`, ink `#18211B`, muted `#556259`. Large areas other than the sidebar and the sign‑in panel stay light.
- **Crest gold `#F6CB17`**: only the 4 px active‑page marker on the green sidebar and keyboard focus on the sidebar (provisional, D‑35).
- Feedback colours (success/danger/warning/info) always come with an icon or text.
- **Type**: Public Sans (UI, tabular numbers) and Source Serif 4 (school name and page titles only), self‑hosted; Noto Tamil families are listed as fallbacks for Tamil text. Scale 12/14/16/18/22/28 px.
- Contrast (measured): body text 15.3:1, muted text ≥ 5.9:1, white on forest 14.3:1, sidebar muted text ≥ 6.4:1, alert/error/success text ≥ 5.4:1.

### Routing (`app/AppRoutes.tsx`)
| Path | Guard | Behaviour |
|---|---|---|
| `/login` | `PublicOnly` | signed‑in users are sent to where they were going (or `/`), or to the password change |
| `/change-password` | `RequirePasswordChange` | only for users with a temporary password; outside the shell |
| everything else | `RequireAuth` → `AppShell` | signed out → `/login` (remembering the page); temporary password → `/change-password` |
| each shell page | `RequirePermission` | missing permission/role → "no access" page |
| unknown path | — | "page not found" inside the shell |

**Single source for pages and menu**: `app/routes.tsx` (`SHELL_ROUTES`). Each page declares its `permission`/`roles` and optional `nav` entry; the sidebar is generated from the same list, so it can only link to pages that exist and that the user may open. Phase 3 pages: Home and Change password. **These checks are UX only** — every API behind a page enforces permission and scope itself (§10, docs/permissions.md).

Deep links need the web server to serve `index.html` for unknown paths (SPA fallback). Vite does this in development; production hosting must be configured to do the same, with `/api` proxied to the API on the same origin.

### Session handling in the UI
- `lib/api-client.ts` emits an event whenever the API answers `UNAUTHORIZED` or `PASSWORD_CHANGE_REQUIRED`. `AuthProvider` listens: a signed‑in user who gets `UNAUTHORIZED` (expired, revoked, deactivated) is signed out with reason `expired` and the sign‑in page says "Your session has ended"; `PASSWORD_CHANGE_REQUIRED` re‑reads the user so the forced change appears.
- When the tab becomes visible again after ≥ 60 s, the session is re‑checked (one `/auth/me` call).
- Only the non‑secret user summary is kept, in memory. Nothing is written to localStorage/sessionStorage.

### Shell layout (`shell/`)
| Width | Sidebar | Header |
|---|---|---|
| ≥ 1024 px | persistent 248 px column (crest, menu sections, school name footer) | breadcrumb, account menu |
| 768–1023 px | 72 px icon rail (labels kept for screen readers and as tooltips); menu button opens the full sidebar over the page | menu button, breadcrumb, account menu |
| < 768 px | hidden; menu button opens a drawer | menu button, crest + TTLMHSS, account menu |

When the sidebar is open as a drawer it is a modal dialog: focus moves to its close button, Escape/backdrop/link click close it, focus returns to the menu button, the rest of the page is `inert`, and page scrolling is locked. The account menu (disclosure pattern) shows name, username, roles, "Change password" and "Sign out"; Escape and outside clicks close it.

### Reusable UI (`components/`)
`Button` (primary/secondary/ghost/danger, loading state with `aria-busy`), `TextField`, `PasswordField` (show/hide toggle), `Alert` (role alert/status by tone), `LoadingState`, `EmptyState`, `ErrorState` (retry), `ConfirmDialog` (native `<dialog>`), toasts (`ToastProvider`/`useToast`, polite live region), `PageHeader`, `Panel`. Kept deliberately small.

### Accessibility
Semantic landmarks (banner, navigation "Main" and "Breadcrumb", main with skip link), labelled inputs with errors linked by `aria-describedby`, focus moved to the first invalid field, visible focus rings, 44 px touch targets, 16 px inputs (no iOS zoom), `prefers-reduced-motion` respected, state never conveyed by colour alone.

### Performance
One `/auth/me`, one `/school/branding` and (on sign‑in only) one `/health` request per page load. JS bundle 384 KB (119 KB gzipped). Fonts load per script via `unicode-range` (Latin pages fetch only the Latin files).

## 12. Admin configuration (Phase 4)

### API (`modules/config/`)
- Routes under `/api/v1/admin/*` (`config.module.ts`), each with `requires('config.manage')` (or `requires('permissions.manage')` for `/admin/permissions*`), Zod schemas from `@ttlmhss/shared/config` for bodies and UUID params.
- `ConfigService` base class: every method starts with `authorize` (re‑checks the permission, signed in, password set); `write()` runs the change and its audit entry in **one transaction**, giving the work transactional repositories (validation reads inside a write must use them — on SQLite a read through the non‑transactional store would wait on the open transaction).
- Services: `SchoolSettingsService`, `AcademicYearService`, `ClassService`, `SubjectService` (`school-structure.services.ts`); `DayStructureService`, `AttendancePolicyService`, `GradeSchemeService` (`schedule-and-rules.services.ts`); `ExamService`, `CategoryService`/`BehaviourConfigService`, `PermissionConfigService` (`exams-and-categories.services.ts`).
- Repository interfaces in `config.repository.ts`; Kysely implementations in `data/kysely/repositories/config/`. Domain errors: `fieldConflict(field, message)` → 409 with `details[{path:'body.<field>'}]` so the UI shows it next to the field.
- Shared rules live in `@ttlmhss/shared` so the browser and the API use the same code: schemas, `attendanceLockDate`/`isAttendanceLocked`, `orderGradeBands`/`gradeFor`, `normalizeMarks`, `PERMISSION_INFO` ceilings.
- **Role permissions at runtime:** `RolePermissionService` (core/auth) loads overrides, builds the effective role table (defaults ± overrides ∩ ceilings), caches it 30 s and is invalidated on save. `buildPrincipal` uses it, so a change applies on the user's next request.

### Endpoints
| Area | Endpoints |
|---|---|
| School details | `GET/PUT /admin/school-settings` (→ `GET /school/branding` updates too) |
| Academic years | `GET/POST /admin/academic-years`, `PATCH/DELETE /admin/academic-years/:id`, `POST …/:id/make-current`, `PUT …/:id/working-days` |
| Classes & sections | `GET/POST /admin/classes`, `PATCH /admin/classes/:id`, `POST /admin/classes/:id/sections`, `PATCH /admin/sections/:id` |
| Subjects | `GET/POST /admin/subjects`, `PATCH /admin/subjects/:id` |
| Periods & breaks | `GET /admin/academic-years/:yearId/day-structure`, `POST …/:yearId/periods`, `POST …/:yearId/day-structure/copy`, `PATCH/DELETE /admin/periods/:id` |
| Attendance locking | `GET/PUT /admin/attendance-policy` |
| Grade scales | `GET/POST /admin/grade-scales`, `PUT/DELETE /admin/grade-scales/:id` |
| Exams | `GET /admin/exams?academicYearId=`, `POST /admin/exams`, `GET/PATCH/DELETE /admin/exams/:id`, `GET/PUT /admin/exams/:examId/classes/:classId/subjects` |
| Behaviour | `GET /admin/behaviour`, `POST /admin/behaviour/categories`, `PATCH …/categories/:id`, `PUT /admin/behaviour/rating-labels` |
| Achievements | `GET/POST /admin/achievement-categories`, `PATCH …/:id` |
| Role permissions | `GET /admin/permissions`, `PUT /admin/permissions/:role` |

### Web (`features/admin/`)
- `admin-pages.ts` lists the setup pages once; `app/routes.tsx` maps them into `SHELL_ROUTES`, the overview (`/admin`) and the in‑page setup navigation read the same list. The sidebar has one "School setup" entry in an "Administration" section (shown only with `config.manage`).
- Pages load with `useResource` (abort on change, keep data while reloading) and save with `useFormSubmit`, which first validates with the **same shared schema** and then maps API `details` to fields; anything else becomes one banner message. Toasts confirm saves; destructive or consequential actions (delete, make current, permission changes, adding suggestions) use confirmation dialogs.
- New UI kit pieces: `SelectField`, `TextAreaField`, `CheckboxField`, `Badge`/`StatusBadge`, `FormDialog` (native `<dialog>`); `PageHeader`/`Panel` gained actions.
- Per‑year pages keep the chosen year in the address (`?year=`). Tables become stacked cards below 768 px; the exam marks grid scrolls sideways inside its panel.
- `BrandingProvider.refresh()` reloads the identity after School details are saved.

## 13. Student & teacher management (Phase 5)

### API (`modules/people/`)
- `PeopleService` base: `authorize(ctx, permission)` and `write(ctx, permission, work)` — the change and its audit entries in **one transaction**; validation reads inside use the transaction's repositories.
- `StudentService` (list with server‑side search/filter/sort/paging and scope, detail, admit, edit, (de)activate, class change, place, delete, issue password), `PromotionService` (candidates, promote), `TeacherService` (list, detail, create, edit, (de)activate, delete, Teacher → Subject, issue password), `ClassTeacherService` (board, assign/replace, end).
- Accounts use the Phase 2 `AccountCredentialsService` inside the same transaction (`createAccount(…, repos)`), so record + account + placement commit together or not at all. Temporary passwords come only from `issueTemporaryPassword` (response `Cache-Control: no-store`).
- Repositories (`people.repository.ts`; Kysely in `data/kysely/repositories/people/`): students (list via one indexed query with a correlated sub‑query choosing each student's placement for the year; `LIKE` wildcards escaped), enrolments, teachers, teacher subjects, class teachers, person accounts (read‑only account status, "unused" check, delete of unused accounts).
- Validation: shared Zod schemas in `@ttlmhss/shared/people` (identifiers, phone/email/PIN, dates, promotion request) — the same rules run in the browser before sending.

### Endpoints
| Area | Endpoints |
|---|---|
| Students | `GET/POST /admin/students`, `GET/PUT/DELETE /admin/students/:id`, `POST …/:id/status`, `POST …/:id/transfer`, `POST …/:id/placements`, `POST …/:id/temporary-password` |
| Promotion | `GET /admin/promotions/candidates?sourceAcademicYearId&sourceSectionId&targetAcademicYearId`, `POST /admin/promotions` |
| Teachers | `GET/POST /admin/teachers`, `GET /admin/teachers/designations`, `GET/PUT/DELETE /admin/teachers/:id`, `POST …/:id/status`, `POST …/:id/subjects`, `DELETE …/:id/subjects/:subjectId`, `POST …/:id/temporary-password` |
| Class teachers | `GET /admin/class-teachers?academicYearId=`, `POST /admin/class-teachers`, `POST /admin/class-teachers/:id/end` |

Lists return `{ items, page, pageSize, total }` (page size ≤ 100).

### Web (`features/people/`)
- Sidebar section **Management**: Students, Teachers (Class teachers and Promotion are reached from those pages). Routes: `/students`, `/students/new`, `/students/:id`, `/students/:id/edit`, `/students/promotion`, `/teachers`, `/teachers/new`, `/teachers/:id`, `/teachers/:id/edit`, `/class-teachers`.
- Lists keep search/filter/sort/page in the address; tables become stacked cards on phones. Profiles are compact (initials avatar, identifiers, placement, status and account badges, actions) with "All details" in a dialog; academic history is a table that only grows.
- Forms are grouped (Admission, Personal, Parent/guardian, Contact, Address, Sign‑in account) with required marks; promotion is a three‑step page with per‑student outcome, bulk "next class", review and confirmation.
- `CredentialNotice` shows a temporary password once with a copy button; it is held only in component state.

## 14. Timetable (Phase 6)

### The relationship
`Teacher → Subject` (Phase 5, `teacher_subjects`) says what a teacher **can** teach. A **timetable entry** says where and when they **do**: Teacher + Subject + Class/Section + Day + Period, inside a timetable **version** of one academic year. Class, teacher and student timetables — and from Phase 7 the attendance context — are derived from the **published** version; nothing is stored twice.

```
Teacher ──(teacher_subjects)──▶ Subject
   │                               │
   └──────▶ timetable_entries ◀────┘   (+ section, day, period, version → academic year)
                     │
      class / teacher / student timetables  ·  Phase 7: Date + Period + Class/Section + Subject + Teacher
```

### API (`modules/timetable/`)
- `TimetableServiceBase` (`timetable-service.ts`): authorize + one-transaction `write` with audit (like Phase 4/5), the week frame (configured working days + periods incl. breaks), view mappers and audit snapshots (`describeEntry`: year, day, period, class/section, subject, teacher — names included).
- `timetable-rules.ts`: every rule in one place — `checkSlot` (working day; period of this year; not a break; active), `checkTeaching` (subject active; teacher active; Teacher → Subject exists), `checkFree` (conflicts A and B against the draft), `draftIssues` (whole-draft re-check before publishing). Database unique indexes back up A and B.
- `TimetableEditorService`: editor view per section, options (scoped sections, active subjects, active teachers with their subjects), version history, start draft (copy of the live version), **apply a batch of changes** (create / update / move / remove, in order, in one transaction; `dryRun` validates and rolls back), publish (atomic: supersede + publish), discard draft.
- `TimetableViewService`: years list, viewable sections, class timetable, teacher timetable (`/timetable/me`), **student timetable foundation** (student → ACTIVE enrolment → section → published entries), **lessons on a date** (Phase 7 foundation).
- Repository: `TimetableRepository` (`timetable.repository.ts`; Kysely in `data/kysely/repositories/timetable/`). Guards added to Phase 4/5 services: a period used by any timetable cannot be deleted; a Teacher → Subject pair used by the draft or live timetable cannot be removed; a teacher with timetable history cannot be deleted.

### Endpoints
| Area | Endpoints | Permission |
|---|---|---|
| Editing | `GET /timetable/years/:yearId/editor?sectionId=`, `GET …/options`, `GET …/versions`, `POST …/draft`, `POST …/draft/changes` `{ sectionId, operations[], dryRun }` | `timetable.manage` (Class Teacher: own section only) |
| Publishing | `POST /timetable/years/:yearId/draft/publish`, `DELETE /timetable/years/:yearId/draft` | `timetable.publish` (administrators) |
| Views | `GET /timetable/years`, `GET /timetable/years/:yearId/sections`, `GET …/sections/:sectionId`, `GET …/teachers/:teacherId`, `GET /timetable/me`, `GET /timetable/students/:studentId`, `GET /timetable/lessons?date=&teacherId=` | `timetable.view` + scope |

A refused change answers 409 with the reason and `details[].path = body.operations.<i>.<field>`; a refused publish answers 409 with one detail per problem lesson (`entries.<entryId>`).

### Web (`features/timetable/`)
- Sidebar **Timetable** (staff only; students get theirs with the portal) → `/timetable/my` (teachers), `/timetable/classes`, `/timetable/edit` (holders of `timetable.manage`), with a sub-navigation.
- `WeekGrid`: wide screens show days × configured periods (times from the configuration, breaks shaded and narrow, empty periods "Free"); the grid scrolls inside its own box if needed, never the page. Phones (< 768 px) show one day at a time as a list with day tabs.
- Editor: unsaved changes are held in the page and **validated by the server (dry run) before they are shown**, so a refused drop/edit never changes the grid. Desktop drag-and-drop uses native HTML5 drag events (no library); every action is also available by click/tap through the lesson form (class/section → day → period → subject → teacher filtered by Teacher → Subject). Save draft sends the batch for real; Publish requires no unsaved changes and asks for confirmation; problems reported by the server are listed. Remove asks first. A version history table shows who created and published each version.
- No "Take Attendance" action yet — it is added in Phase 7 together with attendance (no placeholder screens).

## 15. Period‑wise attendance (Phase 7)

```
Published timetable (version in force on the date)
  → Date + Period → Teacher + Subject + Class/Section      (register = attendance_sessions)
  → students placed in that section on that date            (enrolments)
  → one record per student per period                       (attendance_records: - P A L C)
```

### API (`modules/attendance/`)
- `AttendanceServiceBase` (`attendance-service.ts`): authorize + one‑transaction `write` with audit; `resolveLesson(date, period, section)` — the saved register's snapshot, else the timetable version in force at the end of that school day (`TimetableRepository.versionInForce`); rejects breaks, free periods, non‑working days and dates outside a year. `accessFor` decides view / mark / manage / locked / override per user. Roster helpers follow placement dates (`placementOn`, `rosterOn`).
- `AttendanceRegisterService`: open a register; **save** (changed students only, one transaction, revision check, subject teachers limited to P/A/-, each record audited); student day (class teacher) and multi‑period Leave / C.
- `AttendanceViewService`: a teacher's lessons on a date with register state; class day; class totals over a range; a student's own attendance (dates × periods + totals); manageable classes; administrator register search (paged). These are the reporting foundation for Phase 11.
- Repository `AttendanceRepository` (`attendance.repository.ts`; Kysely in `data/kysely/repositories/attendance/`).
- Percentage: `countAttendance` / `attendancePercentage` in `@ttlmhss/shared` (P ÷ (P + A); null when no P/A).

### Endpoints
| Area | Endpoints | Permission |
|---|---|---|
| Register | `GET /attendance/register?date&periodId&sectionId`, `PUT /attendance/register` `{ date, periodId, sectionId, revision, marks[], override? }` | view / mark (+ scope) |
| Student day | `GET /attendance/student-day?date&studentId`, `PUT /attendance/student-day` `{ studentId, date, periodIds[], status: L|C, leaveReason?, note?, override? }` | view / manage |
| Views | `GET /attendance/lessons?date[&teacherId]`, `/attendance/classes?academicYearId`, `/attendance/class-day?date&sectionId`, `/attendance/class-summary?sectionId&from&to`, `/attendance/students/:id?from&to`, `/attendance/me?from&to`, `/attendance/sessions?…&page&pageSize` (admin) | view + scope |

Errors: 409 with `details[].path = body.marks.<i>.studentId` for a student not on the roll, `body.override` when an administrator must confirm an override, and a "reload" message for a stale revision.

### Web (`features/attendance/`)
- Sidebar **Attendance** → *My lessons* (teachers: a date's lessons with Take / Open attendance and complete/incomplete state), *Class attendance* (class teachers, admins: day matrix with absentees, leave, unmarked periods and %, totals tab, student‑day dialog for multi‑period Leave / C with reasons), *All registers* (admin search), *My attendance* (students: date range, totals, day‑by‑period list). *My timetable* shows **Today's lessons** with the same action.
- Register: lesson header (class, subject, teacher, date, period and time) from the server; roster with roll, admission number, name; segmented radio controls (P A L C -, letters plus labels, 44 px targets); Mark all present (unmarked only); unsaved marker and leave‑page warning; Save attendance; admin override dialog with reason; conflict message with Reload. Phones: one card per student.
- Statuses never rely on colour: each shows its letter and a text label.

## 16. Academic calendar (Phase 8A)

```
weekly pattern (academic_years.working_days)
   ↓ date entry that applies to the class/section (calendar_entries + targets; never overlapping)
   ↓
working / not working  ── CalendarResolver (one per request, loaded with the week frame)
   ↓ consumed by
timetable (lesson days per section, /timetable/lessons) · attendance (registers, lessons, class day, totals, student view)
```

- Shared (`@ttlmhss/shared/calendar`): contract, `resolveWorkingDay`, `appliesTo`, `targetsOverlap`, `classesInRange` (display order), `weeklyWorking`.
- API (`modules/calendar/`): `CalendarResolver` (`isWorking`, `lessonDays`, `workingForAnyone`, `explain`), `CalendarService` (get / create / update / delete with validation and audit), `CalendarRepository` (Kysely in `data/kysely/repositories/calendar/`). Routes: `GET|POST /admin/academic-years/:yearId/calendar`, `PUT|DELETE /admin/calendar-entries/:id` (`config.manage`).
- `loadFrame` (timetable week frame) now carries the resolver, so the timetable rules and every attendance service ask the same object; nothing reads `working_days` directly any more.
- Web (`features/admin/pages/AcademicCalendarPage.tsx`, School setup → **Calendar**): year selector, weekly pattern, month grid (days marked Working / Closed in words, entries as labelled chips with icons; `+` per day), phone list of the month's entries, table of all entries with Edit / Delete, add/edit dialog (date, status, entire school / class range / classes / sections, reason, note) with client validation from the shared schema, discard‑changes and delete confirmations. Dates are plain `YYYY-MM-DD` strings with UTC arithmetic, so the browser time zone never shifts a school date.

## 17. Exams, marks and results (Phase 8B)

```
Academic year → Exam (Phase 4; stage DRAFT → OPEN → CLOSED)
  → Exam subject (exam × class × subject, Phase 4 marking settings)
  → Section → ONE mark sheet (authorised teacher, DRAFT / SUBMITTED / UNLOCKED, revision, settings used)
  → one mark entry per student (enrolment; raw marks per component; derived values at submission)
  → results (computed from SUBMITTED sheets only): subject results → complete result → rank
```
Marks are never period‑based: no timetable lesson is needed or consulted.

- Shared (`@ttlmhss/shared/marks`): contracts; exact arithmetic (`halfUpDiv`, hundredths); `componentsOf`, `scoreSubject` (total, normalised, %, grade, pass), `summarizeExam` (Σ ÷ Σ), `competitionRanks`. The API uses them at submission; the mark‑sheet page uses the same function for its live preview only.
- API (`modules/marks/`):
  - `marks-context.ts` — base service (authorize + one‑transaction `write` with audit), `loadSheetContext` (exam subject + section → year, exam, subject, section, live settings; a section of another class is "not found"), `structureOf` (subject scale else exam scale), roster (`sheetStudents`: placements on the roster date via the attendance roster helpers + students already holding marks).
  - `MarkSheetService` — per‑sheet access (admin; the sheet's teacher if active and teaching the subject; class teacher of the section in that year), Marks home, sheet view, Save draft (changed students only, revision claim, each student audited), Submit (complete check, derived values + settings stored, lock), Unlock (reason), history (from `audit_logs`, entity `mark_sheet`).
  - `MarksAdminService` (`exams.manage`) — exam stage changes, the exam × class × section × subject matrix (teachers per subject, sheet status, entered count, calendar warnings), assign / remove the mark‑entry teacher.
  - `ResultsService` (`results.view`) — student's own exams and results; staff options; class/section results; a student's result for admins and their class teacher. Only SUBMITTED sheets count; rank per the exam's Phase 4 rank scope.
  - Repository `MarksRepository` (`marks.repository.ts`; Kysely in `data/kysely/repositories/marks/`); Phase 4 `ExamService.setSubjects` refuses removing subjects with marks, lowering maximums below entered marks and changing settings of submitted subjects.

### Endpoints
| Area | Endpoints | Permission |
|---|---|---|
| Administration | `GET /admin/exams/:examId/mark-sheets`, `PUT /admin/exams/:examId/stage` `{ stage }`, `PUT /admin/exam-subjects/:examSubjectId/sections/:sectionId/teacher` `{ teacherId|null }` | `exams.manage` |
| Mark sheets | `GET /marks?academicYearId`, `GET /marks/sheet?examSubjectId&sectionId`, `GET /marks/sheet/history?…`, `PUT /marks/sheet` `{ examSubjectId, sectionId, revision, marks[] }`, `POST /marks/sheet/submit` `{ …, revision }`, `POST /marks/sheet/unlock` `{ …, revision, reason }` | `marks.view` + per‑sheet scope; entering/submitting/unlocking decided per sheet (`marks.enter`, `marks.submit`, `marks.edit`) |
| Results | `GET /results/me?academicYearId`, `GET /results/me/exams/:examId`, `GET /results/options?academicYearId`, `GET /results/exams/:examId/sections/:sectionId`, `GET /results/exams/:examId/students/:studentId` | `results.view` + scope |

Errors: 409 with `details[].path = body.marks.<i>.<component>` for a mark above its maximum or a component the subject does not have, `body.marks.<i>.studentId` for a student not on the sheet; 409 "Reload the sheet" for a stale revision; 409 for locked / closed / not‑open states; 403 (same message whether or not it exists) outside scope.

### Web (`features/marks/`, `features/admin/ExamMarksPanels.tsx`)
- Sidebar **Marks** (administrators and teachers): exams of a year with the sheets the user may open (role badge "Your class (view)" for class teachers); the **mark sheet**: context (exam, year, class, subject, maximum made of components, pass marks, convert‑to, grade scale, authorised teacher), status bar ("Draft" / "Submitted · locked" / "Unlocked for correction", "38 / 42 students entered", unsaved changes), Save draft, Submit (confirm), Unlock (reason dialog), stale‑save reload, history panel. Desktop/tablet: table with one numeric box per component (Tab across, Enter moves down), live total / converted / grade / Pass‑Fail; phones: one card per student. Blank boxes stay "-".
- Sidebar **Results**: students — *My results* (year, exam, details, complete result tiles with total / % / Pass‑Fail / rank, subject table — "Not yet available" until finalised; list on phones); class teachers and administrators — class results (year, exam, class; subject status list; students × subjects with total, %, result, rank; cards on phones).
- School setup → Exams: list shows the marks stage; the exam page adds **Marks and results** (stage with confirmations, calendar warnings, sheet counts) and **Mark entry** (per subject and section: maximum, pass, teacher select limited to teachers of the subject, status, entered). Subjects that hold marks cannot be unticked; submitted subjects' settings are shown as locked.

## 18. Student portal, behaviour and achievements (Phase 9)

```
Student portal (own data only — the student id comes from the session)
  profile ← students + enrolments        timetable ← PUBLISHED version of own section
  attendance ← Phase 7/8A views           marks & results ← Phase 8B (SUBMITTED only)
  behaviour ← behaviour_sheets (SUBMITTED) achievements ← achievements (ACTIVE)

Behaviour: Academic year → Exam → Section → ONE behaviour_sheets row (DRAFT → SUBMITTED)
  → behaviour_assessments (per student placement, remark) → behaviour_ratings (per category, 1–5, label at submission)
Achievements: student + academic year + placement on the date → category, title, description, date (ACTIVE / ARCHIVED)
```

- Shared (`@ttlmhss/shared/portal`): profile, behaviour sheet and achievement contracts.
- API:
  - `modules/portal/portal.service.ts` — `/portal/profile` (read‑only, no admin metadata). `modules/portal/phase9.module.ts` registers all Phase 9 routes.
  - `modules/behaviour/behaviour.service.ts` — options (years, open exams, sections in scope, setup problems), sheet view, Save draft / correction (reason) with revision claim and per‑student audit, Submit (completeness, label snapshot), history, a student's own submitted assessments, staff view of one student. Roster and base service reused from `modules/marks/marks-context.ts`.
  - `modules/achievements/achievement.service.ts` — options, scoped list (admin all; class teacher own sections), get, create / update (placement on the date + scope + active category), archive / restore, admin delete of archived ones, a student's own list.
  - Repositories `BehaviourRepository`, `AchievementRepository` (Kysely in `data/kysely/repositories/behaviour|achievements/`).
  - Attendance: the student view's cells now carry `teacherName` (D‑90).

### Endpoints
| Area | Endpoints | Permission |
|---|---|---|
| Portal | `GET /portal/profile`, `GET /portal/behaviour?academicYearId`, `GET /portal/achievements` | `students.view` / `behaviour.view` / `achievements.view`, students only |
| Behaviour | `GET /behaviour/options`, `GET /behaviour/sheet?examId&sectionId`, `GET /behaviour/sheet/history?…`, `PUT /behaviour/sheet` `{ examId, sectionId, revision, rows[], reason? }`, `POST /behaviour/sheet/submit`, `GET /behaviour/students/:id` | view / `behaviour.manage` + section scope |
| Achievements | `GET /achievements/options`, `GET /achievements?…&page`, `POST /achievements`, `GET|PUT|DELETE /achievements/:id`, `POST /achievements/:id/archive|restore` | `achievements.view` / `achievements.manage` + scope |

### Web (`features/portal/`)
- Students: *My portal* (overview + link tiles), *My profile*, *Timetable* (week grid + subjects and teachers), *Attendance* (Phase 7 page, with a per‑lesson list), *Marks & results* (Phase 8B `MyResults` at `/portal/results`), *Behaviour* (cards per exam), *Achievements* (cards).
- Staff: *Behaviour* (year → exam → class; table of students × configured categories with rating drop‑downs and remark; cards on phones; Save draft, Submit with confirmation, correction reason dialog, history); *Achievements* (filters, cards, add/edit dialog with student search through the scoped student list, archive/restore/delete confirmations, pagination). The administrator's student profile shows both (`StudentRecordPanels`).


## 19. Dashboards, announcements and requests (Phase 10)

```
GET /dashboard  (one call per home page; nothing is calculated here)
  admin     ← students/teachers list totals, classes config, AttendanceViewService.schoolDay (class‑day lesson
              logic for every section, calendar‑aware), calendar entries of today, MarkSheetService.home
  teaching  ← AttendanceViewService.lessons (published timetable + calendar + registers), MarkSheetService.home/sheet
  classes[] ← AttendanceViewService.classDay, MarkSheetService.home, BehaviourService.sheet, AchievementService.list
  student   ← PortalService.profile, AttendanceViewService.myDay / myAttendance, ResultsService.myExams/myResult,
              BehaviourService.mine, AchievementService.mine
  shared    ← AnnouncementService.feed, RequestService.list / mine
```

**Dashboards consume the existing source‑of‑truth services** (BR‑DASH‑01): attendance percentages are `countAttendance` through the attendance service, lessons come from the published timetable and the `CalendarResolver`, mark and result states from Phase 8B, behaviour and achievements from Phase 9 with their visibility rules. Each block runs with the caller's own identity, so permissions and scope apply unchanged; a refused block is omitted.

- Shared: `@ttlmhss/shared/communication` (announcement and request contracts, student day) and `/dashboard` (dashboard contract, mark‑task states). Controlled values `AnnouncementAudience`, `AnnouncementStatus`, `RequestStatus` (OPEN/IN_REVIEW/RESOLVED/CLOSED), `ProfileField`.
- API:
  - `modules/dashboard/dashboard.service.ts` — composes the blocks; `modules/dashboard/phase10.module.ts` registers all Phase 10 routes.
  - `modules/announcements/announcement.service.ts` — feed (own audience, published, not expired, current year), get (audience or manager), management list/options, create (publish now or draft), update (re‑target audited), publish, archive, restore.
  - `modules/requests/request.service.ts` — form options (visible exams + subjects via `ResultsService`), create (lesson checked via `AttendanceViewService.myDay`, routing to the class teacher), mine, scoped list, detail with audit history and assignees, status workflow with revision check, assignment.
  - `modules/attendance/attendance-views.service.ts` — new read‑only `schoolDay` (administrators) and `myDay` (students).
  - Repositories `AnnouncementRepository`, `RequestRepository` (Kysely in `data/kysely/repositories/communication/`); `UserAccountRepository.listActiveByRole`.

### Endpoints
| Area | Endpoints | Permission |
|---|---|---|
| Dashboard | `GET /dashboard` | signed in (+ each block's own permission) |
| Announcements | `GET /announcements/feed?page`, `GET /announcements/:id`; `GET /announcements/options`, `GET /announcements?year&status&audience&q&page`, `POST /announcements` `{ announcement, publish }`, `PUT /announcements/:id`, `POST /announcements/:id/publish|archive|restore` | `announcements.view` / `announcements.manage` + scope |
| Requests | `GET /requests/mine`, `GET /requests/options`, `POST /requests`; `GET /requests?year&status&type&section&from&to&page`, `GET /requests/:id`, `POST /requests/:id/status` `{ status, note, revision }`, `POST /requests/:id/assign` `{ assigneeUserId, revision }` | `requests.view` / `requests.create` / `requests.handle` + scope |
| Attendance | `GET /attendance/me/day?date` (the student's lessons that date) | `attendance.view`, students |

### Web (`features/communication/`)
- *Home* (`DashboardPage`): staff layout (numbers, quick actions, Today, Exams and marks, today's lessons via the Phase 7 `LessonList`, mark entry, my class panels, announcements, open requests) or the student home (`StudentHome`: class banner, today, attendance, latest result, behaviour, achievements, my requests, announcements, portal link chips — phone first).
- *Announcements* (feed, full announcement page) and *Manage announcements* (filters, cards, dialog with audience‑dependent class/section, publish now, archive confirmation, restore).
- *My requests* (list + type‑specific form) and *Requests* for reviewers (filters, list) sharing one request page (details, resolution, review actions, assignment, history, link to the record's own page).
- Menu: Announcements for everyone; Requests for administrators and class teachers; My requests for students.

## 20. Reports, PDFs and annual reports (Phase 11)

```
UI (Reports / My reports / annual report page)
  → GET /reports/…?format=json|pdf|xlsx           (authorised route; scope = the source service's)
  → ReportService / AnnualReportService            (composition only — no calculations)
      ← ResultsService (8B results, completeness, ranks)   ← MarkSheetService.sheet (8B)
      ← AttendanceViewService.studentAttendance / classRegister (P ÷ (P + A), calendar)
      ← BehaviourService / AchievementService (Phase 9)    ← Phase 4 weightage (exams)
  → report document (JSON)  ── preview in the browser
                            └─ render/documents.ts → render/report-pdf.ts (PDFKit, A4) → FileResponse
                            └─ render/attendance-xlsx.ts (ExcelJS)                    → FileResponse
```

- **One composition.** Each report is a typed JSON document (`@ttlmhss/shared/reports`); the preview renders it and the PDF/XLSX renderers format it — two presentations of the same data, never two calculations.
- **PDF engine** (`modules/reports/render/report-pdf.ts`): A4 portrait or landscape; official header (logo from `apps/api/assets/ttlmhss-logo-print.jpg` — a 900 px resize of `assets/brand/ttlmhss-logo-enhanced.jpg` made by `pnpm --filter @ttlmhss/web brand:assets` — and only the configured school identity); a compact running header on later pages; fact grids; tables that wrap, never split a row and repeat their header on every page; boxed notes; signature lines; a footer band with "Page x of y" written after layout (buffered pages), so content never enters it. Standard Helvetica fonts.
- **Files** leave through `core/http/file-response.ts`: `defineRoute` sends the bytes with `Content-Disposition: attachment; filename="…"` (sanitised parts), `Cache-Control: no-store` and `nosniff`. Nothing is written to disk; PDF bytes are never logged or audited.
- **Annual reports** (`modules/reports/annual-report.service.ts`, table `annual_reports`): DRAFT content is built live; finalization stores the whole content JSON (`snapshot_json`) and later views/PDFs read only the snapshot. The weighting is `annualPercentBp` in `@ttlmhss/shared`.
- **Attendance** gained one read‑only view, `AttendanceViewService.classRegister` (the class summary plus every lesson cell with period, subject and teacher from the same pass), used by the class report and its Excel export.

### Endpoints
| Area | Endpoints | Permission |
|---|---|---|
| Options | `GET /reports/options?academicYearId` (years, sections in scope, exams, what the caller can produce) | `reports.view` |
| Report card | `GET /reports/exam-card?examId&studentId&format` | `reports.view` + 8B scope |
| Mark sheet | `GET /reports/mark-sheet?examSubjectId&sectionId&format` | `reports.view` + sheet scope |
| Attendance | `GET /reports/attendance/student?studentId&from&to&format`, `GET /reports/attendance/class?sectionId&from&to&format=json|pdf|xlsx` | `reports.view` + attendance scope |
| Performance | `GET /reports/performance?studentId&academicYearId&format` | `reports.view` + student scope |
| Annual | `GET /reports/annual/section?academicYearId&sectionId`, `GET /reports/annual?academicYearId&studentId&format`, `GET /reports/annual/mine`, `POST /reports/annual`, `PUT /reports/annual/:id/remark`, `POST /reports/annual/:id/finalize|publish|unpublish|reopen` | `reports.view` / `reports.generate` + scope |

### Web (`features/reports/`)
- *Reports* (staff): tabs for what the caller may produce — Report cards (exam + class → students with preview and PDF; PDF disabled while incomplete), Mark sheets (the caller's sheets), Attendance (class + range → summary preview, PDF, Excel, per‑student PDF), Student performance (preview, PDF), Annual reports (class list with status).
- *Annual report* page: status, problems that block finalizing, sections A–F (same content as the PDF), remark editor with an optional "start from the suggestion", Finalize / Publish / Unpublish / Reopen (reason) with confirmations, PDF.
- *My reports* (students): published annual reports, report cards (complete results only), attendance report for a chosen range, performance report.

## 21. Production hardening and security (Phase 12A)

No new framework, route, table or migration. What is enforced, and where:

| Area | Mechanism |
|---|---|
| Start‑up configuration | `config/config.ts`: production requires a strong `SESSION_SECRET` (≥ 32 chars, not a placeholder, not repetitive), https `CORS_ORIGINS`, secure cookies, a file/server database. Every environment rejects `*` / non‑origin CORS entries. Problems are listed; values are never echoed |
| Cookies / sessions | Unchanged from Phase 2: HttpOnly, SameSite=Lax, `Secure` + `__Host-` prefix when secure, idle + absolute expiry, server‑side revocation, HMAC‑hashed tokens |
| Headers | `app.ts` (helmet): API CSP `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, X‑Frame‑Options DENY, Referrer‑Policy no‑referrer, nosniff, Permissions‑Policy; HSTS only when `config.hsts` (secure cookies). Web build: CSP `<meta>` injected by `vite.config.ts` (`WEB_CSP`) — exceptions: `style-src 'unsafe-inline'` (React style attributes), `img-src data: blob:`; dev server is exempt (inline hot‑reload preamble). Source maps are `hidden` (not referenced by the bundle) |
| CSRF / CORS | Origin / Sec‑Fetch‑Site check on unsafe methods, JSON‑only bodies (Phase 2); CORS = exact configured origins with credentials |
| Rate limits | `core/http/rate-limits.ts`; `@fastify/rate-limit` runs at `preHandler` (after access control) and keys on the account (`user:<id>`) or the IP (`ip:<addr>`). Sign‑in/password change per IP, temporary passwords 20/min, `/reports/*` 60/min |
| Input validation | Zod on every params/query/body; ids are UUIDs (query filters included — `OptionalIdFilterSchema` treats an empty filter as none); page size 1–100; real calendar dates; report ranges ordered and inside one academic year |
| Errors / logs | Generic 500s; pino redaction of auth headers, cookies, passwords, hashes, tokens and secrets; audit redaction of password/secret/token/hash fields |
| Test isolation | `buildApp` throws if test modules are passed in production; e2e seed refuses non‑`*e2e*.sqlite` targets |

Regression tests: `apps/api/test/phase12a.test.ts` (unsafe production configuration, headers, CORS, error leakage, enumeration, an RBAC sweep of every route for anonymous / student / teacher callers, IDOR across students and sections on SQLite and PostgreSQL, malformed input, rate limits).
