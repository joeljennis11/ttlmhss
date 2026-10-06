import type { ReportSchool } from '@ttlmhss/shared';
import { NotFoundError } from '../../core/errors/app-errors.js';
import { safeFilePart } from '../../core/http/file-response.js';
import type { Repositories } from '../../data/data-store.js';

/** The school identity printed on reports: only what the school has configured (never invented). */
export async function reportSchool(
  repos: Repositories,
): Promise<{ school: ReportSchool; withLogo: boolean }> {
  const s = await repos.schoolSettings.get();
  if (!s) throw new NotFoundError('The school details have not been set up.');
  return {
    school: {
      fullName: s.fullName,
      shortName: s.shortName,
      address: s.address,
      phone: s.phone,
      email: s.email,
      website: s.website,
      motto: s.motto,
      principalName: s.principalName,
    },
    withLogo: s.logoPath !== null,
  };
}

/** TTLMHSS_2026-27_AnnualReport_2026-015[_Term1].pdf — sanitised parts only. */
export function reportFileName(
  shortName: string,
  yearLabel: string,
  kind: string,
  parts: readonly string[],
  extension: 'pdf' | 'xlsx',
): string {
  return `${[shortName, yearLabel, kind, ...parts].map(safeFilePart).join('_')}.${extension}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-21" → "21 Sep 2026". */
export function longDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A stored UTC timestamp in school time: "21 Sep 2026, 14:05". */
export function schoolDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const month = MONTHS[Number(get('month')) - 1] ?? get('month');
  return `${get('day')} ${month} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

/** 84 → "84", 84.5 → "84.5" (never trailing zeros, never invented precision). */
export const num = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(Number(value.toFixed(2)));
export const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? 'Not available' : `${num(value)}%`;
