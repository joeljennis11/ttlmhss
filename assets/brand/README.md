# Official school logo — source of truth

Two files supplied by the school are stored here **exactly as received**. Do not edit, redraw, recolour, crop or replace either.

| File | Supplied | Details | Role |
|---|---|---|---|
| `ttlmhss-logo-enhanced.jpg` | 2026‑10‑03 (with Phase 4) | JPEG, **8000 × 8000 px**, sRGB, ~2 MB, crest centred on white with a ~5 % white margin. SHA‑256 `d4b01519e9e15fea8d9184f872270faa0bef70a0d05368287b137ef7107720fe` | **Current master** for all web copies and (Phase 11) PDFs |
| `ttlmhss-logo-official.jpg` | 2026‑10‑03 (before Phase 3) | JPEG, 556 × 556 px, crest fills the square. SHA‑256 `e99c0f341a9e0871a88cb5a9215cfc0019777158291356138e0e708818e51d64` | Kept for reference; no longer used to generate assets |

The enhanced file is the same artwork at print resolution, without the small stray mark visible in the first file. Measured colours: green ≈ `#335729`, gold ≈ `#FBCB0F`, white.

## How the application uses it
- `pnpm --filter @ttlmhss/web brand:assets` generates, by **resizing only** (deterministic, no AI), into `apps/web/public/brand/`: `ttlmhss-logo.webp` (512 px), `favicon-32.png`, `apple-touch-icon.png`. The script verifies the master's checksum first and refuses to run if the file changed unexpectedly.
- The school settings (`school_settings.logo_path`, editable by Admin) point at `/brand/ttlmhss-logo.webp`; every screen reads the logo from there (sign‑in, sidebar, phone header). The favicon is linked from `apps/web/index.html`.
- Report/PDF branding (Phase 11): the same script also writes `apps/api/assets/ttlmhss-logo-print.jpg` (900 px JPEG, resize only) — sharp at the printed size on A4 without embedding the 2 MB master in every PDF.

If the school supplies a newer official file: add it here unchanged, update the source path and `EXPECTED_SHA256` in `apps/web/scripts/build-brand-assets.mjs`, update this table, and re-run the script.
