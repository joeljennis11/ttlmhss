# Architecture — TTLMHSS (Proposal)

Status: **Proposed in Phase 0. Items marked "Needs confirmation" are not locked** — see [decisions.md](decisions.md). The database provider is deliberately undecided.

---

## 1. Shape of the system

```
┌──────────────────────────┐        HTTPS (JSON)        ┌───────────────────────────────────────────────┐
│ Web client (SPA)         │ ─────────────────────────▶ │ API server                                    │
│  pages → features →      │   httpOnly session cookie  │  routes/controllers (HTTP only)               │
│  components, API client  │ ◀───────────────────────── │    ↓ validate (schemas)  ↓ authenticate       │
└──────────────────────────┘                             │  services (business rules)                    │
                                                         │    ↓ authorize (policies)  ↓ audit            │
                                                         │  repositories (interfaces)                    │
                                                         │    ↓                                          │
                                                         │  data adapter (ORM/driver) ──▶ Database (TBD) │
                                                         │  reports: data → template → PDF / Excel       │
                                                         └───────────────────────────────────────────────┘
```

One deployable API + one static web client. A monorepo keeps shared types and validation schemas in one place. No microservices — the school's scale does not justify them.

## 2. Proposed technology stack

| Concern | Recommendation | Alternatives considered | Status |
|---|---|---|---|
| Language | **TypeScript** end‑to‑end | — | Needs confirmation (D‑01) |
| Repo layout | **pnpm workspaces monorepo** (`apps/web`, `apps/api`, `packages/shared`) | separate repos; Next.js full‑stack single app | Needs confirmation (D‑01) |
| Frontend | **React + Vite**, React Router, TanStack Query, React Hook Form + Zod, Tailwind CSS with a small in‑house component set (Radix primitives) | Next.js; Vue/Nuxt | Needs confirmation (D‑02) |
| Backend | **Node.js + Fastify**, modular by feature | NestJS (more structure, more ceremony); Express | Needs confirmation (D‑02) |
| Validation | **Zod** schemas in `packages/shared`, used by both client and server | class‑validator | Follows D‑01 |
| Data access | **Repository interfaces** in the domain + an ORM adapter. Recommended ORM: **Prisma** or **Drizzle** — both support SQLite, PostgreSQL and MySQL, keeping the provider open | Kysely; raw SQL | ORM needs confirmation (D‑03); **provider undecided (D‑04)** |
| Passwords | **argon2id** | bcrypt | Recommended |
| Sessions | **Server‑side sessions, httpOnly + Secure + SameSite cookies**, CSRF protection | JWT access/refresh tokens | Recommended (D‑18) |
| PDF | **HTML/CSS templates rendered by headless Chromium (Playwright)** | pdfmake / PDFKit (programmatic) | Needs confirmation (D‑19) |
| Excel | **ExcelJS** | SheetJS | Recommended |
| Testing | **Vitest** (unit/service), **Supertest/fastify.inject** (API), **Playwright** (E2E) | Jest, Cypress | Recommended |
| Lint/format | ESLint + Prettier, strict TS | — | Recommended |

Rationale in short: one language and shared schemas reduce duplicated validation and drift; Fastify is fast, simple and plugin‑based, which suits a clean feature‑module layout; headless‑Chromium PDFs reuse HTML/CSS, which makes branded A4 layouts, tables and **Tamil script rendering** (names, Tamil subject) far more reliable than programmatic PDF libraries.

## 3. Proposed repository layout (created in Phase 1, not now)

```
apps/
  web/                 React SPA
    src/app/           routing, providers, layout shell
    src/features/<x>/  per-feature pages, components, hooks, api calls
    src/components/ui/ shared design-system components
    src/lib/           api client, auth context, formatting
  api/
    src/modules/<x>/   per-feature: routes.ts, service.ts, policy.ts, repository.ts, schemas
    src/core/          auth, authorization engine, audit, errors, config, db adapter
    src/reports/       report data builders, HTML templates, renderer
packages/
  shared/              Zod schemas, DTO types, enums (status codes P/A/L/C/-), constants
docs/                  this documentation
```

Feature modules (`students`, `teachers`, `timetable`, `attendance`, `exams`, `marks`, …) are added only in their phase.

## 4. Boundaries

### Frontend
- Presents data and collects input. **Contains no authoritative business logic** — e.g. it may preview an attendance %, but the value it shows comes from the API.
- Permission‑aware UI (hiding actions) is a convenience only.
- Every async view has loading, empty and error states; destructive actions need confirmation; results surface as toasts.
- Design tokens: `--brand-900: #003300` plus derived tints/shades; neutral surfaces for content.

### API layer (routes/controllers)
- REST, JSON, versioned under `/api/v1`.
- Responsibilities: parse + validate input (Zod), call one service method, map the result/error to HTTP. No business rules, no database calls.
- Resource style, e.g.:
  - `GET /api/v1/timetable/sections/:sectionId` · `POST /api/v1/timetable/drafts/:id/publish`
  - `GET /api/v1/attendance/sessions?date=&sectionId=&period=` · `PUT /api/v1/attendance/sessions/:id/marks`
  - `PUT /api/v1/marks/sheets/:examId/:subjectId/:sectionId` · `POST …/submit` · `POST …/unlock`
  - `GET /api/v1/me/results` (student endpoints derive identity from session)
- Consistent error envelope `{ error: { code, message, details } }`; pagination `?page=&pageSize=`.

### Authentication boundary
- Module `core/auth`: login, logout, session issue/rotate/revoke, password hashing, first‑login password change, rate limiting on login.
- Produces an **authenticated principal** `{ userId, role, teacherId?, studentId? }` attached to the request. Nothing downstream reads cookies or tokens directly.

### Authorization boundary
- Module `core/authz` + per‑feature `policy.ts`.
- Route declares a permission key (deny by default). The service calls a policy with the principal and the target resource to check **scope** (own period, own class, self) and **time rules** (cutoff, lock, archived year).
- Scope is resolved from assignments in the database, never from client input. See [permissions.md](permissions.md).

### Service / business‑logic boundary
- `modules/<x>/service.ts` holds all domain rules (conflict detection, attendance %, lock rules, visibility, weightage, ranking, grade computation).
- Services depend on **repository interfaces**, the authorization policy and the audit writer — never on HTTP or a concrete DB client. This keeps rules unit‑testable without a database.
- Multi‑record operations (publish timetable, submit marks, promote class) run inside a **unit of work/transaction** supplied by the data layer.

### Data‑access boundary
- `modules/<x>/repository.ts` defines interfaces (`AttendanceRepository.findSession(...)`); `core/db` provides the implementation for the chosen ORM/provider.
- Only repository implementations import the ORM. Swapping the provider means changing the adapter and migrations, not services.
- Use only portable features by default (no provider‑specific SQL in services). Soft‑delete/archival conventions are applied consistently.

### PDF / report boundary
- `reports/` is a separate layer with three steps: **data builder** (calls services, already authorized) → **template** (HTML/CSS, A4, branding, logo, page numbers, signatures) → **renderer** (headless Chromium → PDF; ExcelJS → .xlsx).
- Reports never query the database directly and never bypass authorization.
- Heavy jobs (whole‑class annual reports) can be queued later; synchronous generation is fine initially.

### Configuration
- **Deployment config** via environment variables, validated at startup with a schema (`DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, etc.). `.env.example` committed; real `.env` never committed.
- **School configuration** (periods, lock rules, grades, weightage, behaviour labels, profile fields, school details) is **data in the database**, edited by Admin, read through a cached config service — not hard‑coded.
- Static assets: official logo stored once (e.g. `apps/web/public/brand/` and referenced by reports) after the user provides it.

### Audit
- `core/audit` writes append‑only entries `{ actor, action, entity, entityId, before, after, reason, timestamp }` within the same transaction as the change. Domain‑specific audit (attendance changes) may also have a dedicated table for efficient querying.

## 5. Testing approach

| Level | What | Tooling |
|---|---|---|
| Unit | Pure business rules: attendance % (P/(P+A)), lock date calculation, timetable conflict detection, grade/normalization/weightage, ranking with ties, visibility rules | Vitest |
| Service | Services with in‑memory or test‑DB repositories; authorization scope cases (teacher can't mark another's period, student can't read another student) | Vitest |
| API / integration | Real HTTP against a test database: auth, deny‑by‑default, validation, error envelope | Vitest + Fastify inject |
| E2E | Critical flows per role (login → take attendance; submit marks → student sees subject) | Playwright |
| PDF | Smoke tests that PDFs generate, are A4 and contain key fields | Vitest + pdf parsing |

Every business rule in [business-rules.md](business-rules.md) should be traceable to at least one test by its ID. CI (later) runs lint, typecheck and tests on each change.

## 6. Security baseline

argon2id hashing · httpOnly/Secure/SameSite cookies + CSRF tokens · login rate limiting and lockout · Zod validation on every input · ORM/parameterized queries only · security headers (helmet‑style) · CORS restricted to the web origin · secrets only in env · least‑privilege DB user · audit logging · file uploads (photos, certificates) type/size‑checked and stored outside the web root.

## 7. Deployment (undecided)

Hosting target (cloud VM, PaaS, on‑premise school server) is undecided (D‑20) and influences the database choice. The proposal works on any Node.js host.
