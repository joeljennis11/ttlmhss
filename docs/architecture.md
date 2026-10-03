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
