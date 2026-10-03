import type { SchoolBranding } from '@ttlmhss/shared';

/**
 * The ONLY place the school identity is written in the web app.
 *
 * The live values come from the API (GET /school/branding, stored in the database and editable by
 * Admin in Phase 4). These defaults are shown only until that response arrives or if it fails, so
 * the sign-in page never renders without the school's name and crest.
 */
export const DEFAULT_BRANDING: SchoolBranding = Object.freeze({
  shortName: 'TTLMHSS',
  fullName: 'Thiruthangal Lions Matriculation Higher Secondary School',
  primaryColor: '#003300',
  /** Web copy of the official logo, resized from assets/brand/ttlmhss-logo-enhanced.jpg (artwork unchanged). */
  logoUrl: '/brand/ttlmhss-logo.webp',
});
