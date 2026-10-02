# Architecture — TTLMHSS

Status after **Phase 1**: the foundation described in §2–§7 is **implemented and verified**. Items in §9 remain proposals. Open decisions live in [decisions.md](decisions.md); the database provider is still **not finalised** (D‑04).

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

## 2. Technology — what was actually adopted in Phase 1

| Concern | Adopted | Notes |
|---|---|---|
| Language | TypeScript 6.0 (strict, `noUncheckedIndexedAccess`) | TS 7.x exists but typescript‑eslint supports `<6.1`; pinned `~6.0.3`. |
| Runtime | Node.js ≥ 22.12 (`.nvmrc` = 22) | |
| Repo | pnpm 10 workspaces: `apps/api`, `apps/web`, `packages/shared` | |
| Backend | Fastify 5, `@fastify/helmet`, `@fastify/cors` | |
| Validation | Zod 4, shared building blocks in `@ttlmhss/shared` | |
| Data access | **Kysely 0.29** query builder + migrations, behind repository interfaces | **Deviation from Phase 0** (was "Prisma or Drizzle") — see §8. |
| DB drivers | `better-sqlite3` (SQLite), `pg` (PostgreSQL) | Selected at runtime from `DATABASE_URL`; loaded lazily. |
| Frontend | React 19 + Vite 8, CSS custom‑property design tokens + CSS Modules | Tailwind/Radix/TanStack Query/React Router **not added yet** — only one page exists. Decided in Phase 3 (D‑27). |
| Logging | Pino (Fastify built‑in); pretty output in development, JSON elsewhere | |
| Testing | Vitest 5 (projects: shared, api, web); PGlite for PostgreSQL tests | |
| Lint/format | ESLint 10 (flat config) + typescript‑eslint + react‑hooks, Prettier 3 | |

Not yet used (planned for later phases): argon2id, sessions/CSRF, rate limiting (Phase 2), PDF/Excel generation (Phase 11), Playwright E2E.

## 3. Repository layout (actual)

```
apps/
  api/
    src/
      server.ts              process entry: config → data store → schema check → listen → graceful shutdown
      app.ts                 buildApp(deps): Fastify factory (helmet, cors, request ids, error handling, access hook, modules)
      app-dependencies.ts    AppDependencies: config, dataStore, clock, authenticator, accessPolicy
      modules.ts             list of registered feature modules
      config/                env loading (.env precedence), Zod-validated AppConfig, DATABASE_URL parsing
      core/
        auth/                Principal, AccessRequirement, Authenticator/AccessPolicy interfaces, access hook
        errors/              AppError hierarchy + the single error → HTTP mapper
        http/                defineRoute / registerRoutes convention, FeatureModule type
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
      scripts/db.ts          migrate / rollback / status CLI
    test/                    config, HTTP foundation, data layer (SQLite + PostgreSQL); support/ harness + PGlite dialect
    .env.example .env.development .env.test
  web/
    src/
      main.tsx App.tsx
      styles/                tokens.css (brand scale from #003300), base.css
      lib/                   api-client.ts, use-api-query.ts
      features/foundation/   FoundationStatus page (identity + system status)
    test/                    api-client tests
packages/
  shared/src/                api-contract.ts, controlled-values.ts, validation.ts
docs/                        this documentation
```

## 4. Boundaries (as implemented)

### Frontend
- Reaches data **only** through `lib/api-client.ts` (`/api/v1/...`), which validates payloads with shared Zod schemas and turns the error envelope into `ApiClientError` with a user‑safe message.
- ESLint forbids importing backend code into `apps/web`.
- Every async view has loading / error / success states (`useApiQuery`).
- Brand tokens: `--brand-900: #003300` plus derived tints/shades; neutral surfaces for content. No logo or favicon until the official logo is supplied.

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
- Codes: `VALIDATION_ERROR 400`, `UNAUTHORIZED 401`, `FORBIDDEN 403`, `NOT_FOUND 404`, `CONFLICT 409`, `INTERNAL_ERROR 500`, `SERVICE_UNAVAILABLE 503`.
- Every response carries `x-request-id` (server‑generated; client values ignored) which also appears in logs.

### Error handling
- Services/repositories throw `ValidationError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`, `ForbiddenError`, `ServiceUnavailableError`, `InternalError`.
- One error handler maps them. Unknown errors and `InternalError` → 500 with a generic message; the real error is logged only. Malformed JSON / oversized bodies → 4xx without internals.

### Authentication & authorization boundary (fail‑closed)
- `Authenticator.authenticate(request) → Principal | null` and `AccessPolicy.isAllowed(principal, requirement)` are interfaces injected via `AppDependencies`.
- A global `onRequest` hook enforces each route's declared `access`: public → allowed; otherwise no principal → 401, policy denies → 403; a route **without** a declaration → 500 (never exposed).
- **Phase 1 wiring:** `noAuthentication` + `denyAllPolicy` — nobody can authenticate and every non‑public route is refused. There is no temporary or bypass login. Phase 2 supplies real implementations; record‑level scope checks will live in per‑feature `policy.ts` files called by services.

### Service / business‑logic boundary
- Services receive repository interfaces, `Clock`, and (from Phase 2) policies. They never import Kysely, SQL or drivers — **enforced by ESLint** (`no-restricted-imports` on `apps/api/src/**` except `src/data/kysely/**`, `src/data/index.ts` and the CLI).

### Data‑access boundary
- `DataStore` exposes `repositories`, `transaction(work)` (unit of work: all writes, including audit entries, commit or roll back together), `ping()`, `schema` (migrations) and `close()`.
- Repository implementations translate driver errors: unique / foreign‑key / restrict violations → `ConflictError`; CHECK / NOT NULL → `InternalError` (validation should have caught it); connection failures → `ServiceUnavailableError`.
- Phase 1 repositories: `SchoolSettingsRepository` (read), `AuditLogRepository` (append‑only: append + listForEntity). Feature repositories arrive with their features.

### Audit
- `AuditRecorder(repository, clock).record(event, { actorUserId, requestId })` writes `audit_logs` rows; keys matching password/secret/token/hash are redacted. Construct it with the repositories of the current transaction. No feature emits audit events yet.

### Configuration
- **Deployment configuration** (`apps/api/src/config`): Zod‑validated at startup; invalid config stops the process listing every problem without echoing values. Precedence: real env → `.env.<mode>.local` → `.env.<mode>` → `.env`. Modes: development, test, production. Production additionally rejects in‑memory databases and requires `CORS_ORIGINS`. `.env.development` / `.env.test` are committed (no secrets); `.env`, `*.local`, `.env.production` are git‑ignored.
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
| `apps/web/test/api-client.test.ts` | envelope parsing, error/network/invalid‑payload handling |

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
| `pnpm test` / `pnpm test:watch` | all test suites |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm format:check` | static checks |
| `pnpm check` | lint + format check + typecheck + tests |

## 8. Deviations from Phase 0 (and why)

1. **Kysely instead of Prisma/Drizzle (D‑03).** Prisma pins one provider per schema file and depends on downloaded engine binaries; Drizzle needs a separate table definition per dialect (`sqliteTable` vs `pgTable`). Kysely lets one set of migrations and one set of repositories run unchanged on SQLite and PostgreSQL — which the test suite proves — so the provider stays genuinely replaceable. Trade‑off: row types are written by hand (`database-schema.ts`) and kept honest by the data‑layer tests.
2. **Portable storage conventions:** text UUID ids generated by the app, ISO‑8601 text timestamps, `YYYY-MM-DD` dates, `HH:MM` times, text + CHECK for controlled values, `status` columns instead of booleans. Chosen so both providers behave identically; if PostgreSQL is chosen, native `timestamptz`/`uuid` types can be adopted in a later migration.
3. **Frontend libraries deferred:** Tailwind, Radix, React Router and TanStack Query were proposed but are not installed because Phase 1 has a single status page. To be confirmed in Phase 3 (D‑27).
4. **Feature tables deferred to their phases** — see [database-design.md](database-design.md) §5.

## 9. Still proposals (not implemented)
- Sessions with httpOnly cookies + CSRF, argon2id, login rate limiting (D‑18, Phase 2).
- PDF via HTML/CSS + headless Chromium; Excel via ExcelJS (D‑19, Phase 11).
- Playwright E2E tests (from Phase 3, once there is UI to test).
- Hosting target (D‑20).
