/**
 * Per-route request limits (Phase 12A). Signed-in callers are counted per account, anonymous
 * callers per IP (see app.ts). Generous enough for normal school use; they stop scripted abuse.
 */
const MINUTE = 60_000;

/** Issuing a temporary password (the new credential is shown once to the administrator). */
export const CREDENTIAL_ISSUE_LIMIT = { max: 20, timeWindowMs: MINUTE };

/** Report previews and PDF/XLSX generation (CPU-heavy documents). */
export const REPORT_LIMIT = { max: 60, timeWindowMs: MINUTE };
