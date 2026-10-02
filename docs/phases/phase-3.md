# Phase 3 — Branding, Sign-in and Application Shell

**Date:** 2026‑10‑03
**Status:** Complete. Awaiting explicit Phase 4 instruction.

## Objective
Give TTLMHSS its official identity, a real sign‑in experience on the Phase 2 authentication, and a reusable, responsive, role‑aware application shell that later modules plug into — without building any business module.

## Starting state
Phase 2 committed (146 tests); the official logo had been stored unmodified at `assets/brand/ttlmhss-logo-official.jpg`. The web app had functional but unstyled sign‑in/change‑password screens and no routing.

## What was implemented
**Branding**
- `brand:assets` script generates `public/brand/ttlmhss-logo.webp` (512 px), `favicon-32.png`, `apple-touch-icon.png` from the official file — resize only, checksum‑guarded. Original untouched.
- Migration `0004_school_logo` points `school_settings.logo_path` at the web logo, so `GET /school/branding` is the single source; `brand/brand.ts` is the only fallback copy of the names in the web app.
- `SchoolLogo` shows the crest as a circle (it fills its square image edge to edge, so only the white corners are hidden).
- Design tokens (`styles/tokens.css`): Forest `#003300` primary with derived shades, cool neutral canvas, crest gold as a single sidebar marker (D‑35, provisional), feedback colours. Self‑hosted Public Sans + Source Serif 4.

**Sign-in** (`features/auth/LoginPage.tsx`)
- Desktop: crest and full school name on the forest panel, form on white. Phones/tablets: compact forest band leading with "TTLMHSS" above the form.
- Username + password with show/hide toggle, client‑side required‑field messages with focus on the first problem, loading state (`aria-busy`, disabled, "Signing in…"), server field errors, generic credential failure, rate‑limit and network/server messages in plain words, "session has ended" notice, system‑down notice (only when the API/database is unavailable).
- Uses the real Phase 2 endpoint; temporary passwords route to the mandatory change page (`ForcedPasswordChangePage`) with live password‑rule feedback.

**Application shell**
- `AppShell`: persistent sidebar ≥1024 px, icon rail 768–1023 px, drawer <768 px (modal, focus‑managed, Escape/backdrop close, page `inert`).
- `Sidebar`: crest + TTLMHSS, menu generated from `SHELL_ROUTES`, sections, gold active marker, school full name footer.
- `Header`: menu button (tablet/phone), breadcrumb (tablet/desktop), crest + TTLMHSS (phone), account menu with name, username, roles, Change password, Sign out.
- Pages that exist: Home (welcome + real account facts + an honest "tools will appear here" note — no statistics), Change password, Page not found, No access.
- Toasts for "Password changed", "You have signed out".

**Routing & session UX**: React Router 8; guards `RequireAuth`, `PublicOnly`, `RequirePasswordChange`, `RequirePermission`; return to the requested page after sign‑in; central handling of 401/`PASSWORD_CHANGE_REQUIRED` via API‑client events; session re‑check when the tab regains focus.

**Reusable UI**: Button, TextField, PasswordField, Alert, Spinner, Loading/Empty/Error states, ConfirmDialog, Toasts, PageHeader, Panel.

**Backend changes**: only migration 0004 (logo path). No new endpoints, no auth changes, no provider change.

## Decisions
- D‑27 adopted: React Router 8, CSS Modules + tokens, lucide‑react, self‑hosted fonts; no Tailwind/Radix/TanStack Query (awaiting confirmation).
- D‑35 provisional: `#003300` stays primary; crest gold used only as the active marker/focus on the sidebar.
- Phase 2 minimal screens (`AuthGate`, `SignedInHome`, `SystemStatus`, old `ChangePasswordPage`) and `use-api-query` were replaced by the above.

## Tests and checks (all actually run)
| Check | Result |
|---|---|
| `pnpm check` (format, lint, typecheck, unit/integration/component tests) | clean — **162 tests in 11 files** (Phase 2: 146) |
| `pnpm --filter @ttlmhss/web test:e2e` (Playwright, real API + throwaway DB) | **16/16 pass** — sign‑in flows, roles, protected routes, temp‑password flow, server‑side sign‑out, session ended elsewhere, desktop/tablet/mobile layouts |
| `pnpm build` | shared, api, web build (web JS 384 KB / 119 KB gzip) |
| Visual review | screenshots at 1440×900, 820×1180, 390×844 of sign‑in (empty, errors, failure, session ended), forced change, home, account menu, drawer, change password, 404, signed out; 5 issues found and fixed (below) |
| Horizontal overflow | 0 px at all three sizes (sign‑in and home) |
| Contrast | all text pairs ≥ 4.5:1 (lowest 5.39) |
| Phase 2 regression | all API auth/authorization tests pass; e2e covers real sign‑in/out against the API |

Browser note: Playwright's Chromium download is blocked in this build environment, so the e2e run and screenshots used a Chromium binary obtained through npm (`CHROMIUM_PATH`). It is not a project dependency; normal machines use `playwright install chromium`.

## Issues found and fixed during this phase
1. Sign‑in subtitle wrapped awkwardly → shorter copy.
2. Home repeated name and username for accounts without a profile → name row only when different.
3. Phone/tablet sign‑in header put "TTLMHSS" beside a wrapping full name → stacked, short name first.
4. A password rule showed "met" for a 3‑character password → judged only once long enough.
5. Link‑styled buttons were underlined → fixed in the button style.
Also: React hook rule findings (ref writes during render, state set inside an effect) refactored rather than suppressed; cluttered accessible name on the account button replaced with a clear label; page heading block no longer a second "banner" landmark.

## Files added / changed (main)
- Added: `assets`‑derived `apps/web/public/brand/*`, `apps/web/scripts/build-brand-assets.mjs`; `src/app/*`, `src/brand/*`, `src/shell/*`, `src/pages/*`, `src/components/ui/*`, `src/components/layout/*`, `src/features/auth/{LoginPage,ForcedPasswordChangePage,ChangePasswordForm}*`, `src/features/system/SystemNotice.tsx`, `src/lib/{roles,use-media-query}.ts`; tests `test/app.test.tsx`, `test/navigation.test.ts`, `test/setup.ts`, `test/support/render-app.tsx`, `e2e/auth-shell.spec.ts`, `playwright.config.ts`; API `migrations/0004_school_logo.ts`, `test/e2e/seed.ts`.
- Changed: `index.html` (favicons), `main.tsx`, `styles/*`, `lib/api-client.ts`, `features/auth/auth-context.tsx`, `vitest.config.ts`, web `package.json`, `eslint.config.js`, API data‑layer/HTTP tests (logo path, fourth migration), docs.
- Removed: Phase 2 minimal screens listed above.

## Known limitations
- Production hosting must serve `index.html` for unknown paths and proxy `/api` on the same origin (not configured here; deployment is out of scope).
- The 556 px logo is fine on screen; a higher‑resolution/vector original would help print (D‑34).
- The small blue mark near the centre of the supplied crest remains (logo is not modified) — a clean original would remove it.
- Tablet rail has only two items until modules exist; labels are tooltips there.
- Fonts include Tamil fallbacks by name only (Noto Tamil families if installed); a self‑hosted Tamil face can be added when Tamil text appears.

## What Phase 4 needs to know
- Add Admin configuration pages to `SHELL_ROUTES` with `permission: 'config.manage'` (or the relevant key) and a `nav` entry; the menu and "no access" behaviour follow automatically. Back them with API routes using `requires(...)` plus service‑level `authorize` + scope checks.
- Use `PageHeader`, `Panel`, the form fields, `Alert`, states, `ConfirmDialog` (destructive/irreversible actions) and `useToast` for consistency.
- School name/logo edits by Admin should update `school_settings`; the UI already reads them from `GET /school/branding`.
- If the school supplies a new official logo, replace the file in `assets/brand/`, update the checksum in the script and README, and run `brand:assets`.
