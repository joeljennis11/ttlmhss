# Phase 12A — Production hardening and security

**Scope:** an audit of the existing application and fixes for the real weaknesses found. No new features, no deployment, no hosting or domain configuration, no architecture/auth/RBAC/database rewrite, no new framework. Phases 12B and 12C are not started.

## Audit results

The Phase 2–11 baseline was already sound: Argon2 hashing, no plaintext or logged passwords, forced first‑login change, deactivated accounts refused, idle + absolute session expiry with server‑side revocation, HMAC‑hashed session tokens, constant‑time login for unknown users (dummy hash), per‑username lockout, Origin/Sec‑Fetch‑Site CSRF check, JSON‑only bodies, 1 MB body limit, generic error responses, pino + audit redaction, parameterised Kysely queries (the only `sql.ref`/`sql.lit` uses take code constants, never request data), transactions around every audited change, foreign keys without cascading deletes, UUID path params, page size ≤ 100, report ranges confined to one academic year, `no-store` + `nosniff` + sanitised file names on PDF/XLSX downloads, e2e seed restricted to `*e2e*.sqlite`.

| # | Finding | Severity | Fix |
|---|---|---|---|
| F1 | Production accepted `COOKIE_SECURE=false` (session cookie over plain HTTP) | High | Refused at start‑up (D‑112) |
| F2 | `CORS_ORIGINS` accepted `*`, paths and any scheme; http origins in production | Medium | Exact origins only everywhere; https required in production (D‑113) |
| F3 | A 32‑char placeholder or repetitive `SESSION_SECRET` passed | Medium | Placeholder / low‑variety values refused in production |
| F4 | HSTS sent unconditionally (also on plain‑http development) | Low | Only when secure cookies (HTTPS) |
| F5 | Helmet's default CSP is for HTML pages; no Permissions‑Policy; web build had no CSP | Medium | Strict API CSP + Permissions‑Policy + DENY framing + no‑referrer; CSP `<meta>` in the built web app (D‑114) |
| F6 | No rate limit on temporary‑password issuance or report/PDF/XLSX generation | Medium | 20/min and 60/min, per account (D‑115) |
| F7 | Login‑style per‑IP keys would throttle a whole school behind one NAT if applied to staff routes | Design | Limits run after access control and key on the account when signed in |
| F8 | Student/teacher list and promotion queries accepted any string as an id | Low | `IdSchema` / `OptionalIdFilterSchema` (empty = no filter) |
| F9 | Nothing prevented test‑only modules being mounted in a production process | Low | `buildApp` throws in production |
| F10 | Production web bundle referenced its source maps | Info | `sourcemap: 'hidden'` |
| F11 | `uuid` < 11.1.1 (moderate) via ExcelJS | Not reachable | Documented (D‑117) |

The accounts CLI prints a newly issued temporary password once to the operator's terminal by design (it is the delivery channel); it is never written to logs or the database.

## Files

- `apps/api/src/config/config.ts` — origin and secret checks, production refusals, `hsts`.
- `apps/api/src/app.ts` — helmet options, Permissions‑Policy, account/IP rate‑limit key at `preHandler`, production guard for test modules.
- `apps/api/src/core/http/rate-limits.ts` (new) — `CREDENTIAL_ISSUE_LIMIT`, `REPORT_LIMIT`; used by `people.module.ts` and `reports.module.ts`.
- `packages/shared/src/validation.ts` — `OptionalIdFilterSchema`; `people.ts` query schemas use it.
- `apps/web/vite.config.ts` — `WEB_CSP` meta for builds, hidden source maps.
- `apps/api/.env.example` — documents the new rules (placeholders only).
- `apps/api/test/phase12a.test.ts` (new) — the security regression suite.

## Database

No migration, no schema change. `pnpm db:migrate` is not needed for this phase.

## Verification

- `pnpm check` (lint, format, typecheck, all unit/integration tests on SQLite and PostgreSQL/PGlite).
- Full Playwright e2e suite against the dev server.
- `pnpm build`; the built web app was additionally loaded under its CSP in Chromium (sign‑in, navigation, logo, fonts) with no CSP violations.

## Limitations (left for 12B/12C deployment)

- `frame-ancestors` and HSTS for the web app must be sent as headers by the host serving `apps/web/dist`.
- Rate‑limit counters are in memory (single API process); several processes need a shared store.
- `TRUST_PROXY` must be set when behind a reverse proxy so per‑IP limits see the real client.
- PDFs use standard fonts (Latin only), unchanged from Phase 11.
