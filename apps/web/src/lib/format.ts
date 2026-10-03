import type { Weekday } from '@ttlmhss/shared';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const longDateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "2026-06-01" → "1 Jun 2026". */
export const formatDate = (iso: string) => dateFormat.format(parse(iso));
/** "2026-06-01" → "1 June 2026". */
export const formatLongDate = (iso: string) => longDateFormat.format(parse(iso));
/** (2026, 9) → "September 2026". */
export const formatMonth = (year: number, month: number) =>
  monthFormat.format(new Date(Date.UTC(year, month - 1, 1)));

/** The day before an ISO date. */
export function previousDay(iso: string): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const WEEKDAY_LABELS: Record<Weekday, { short: string; long: string }> = {
  MON: { short: 'Mon', long: 'Monday' },
  TUE: { short: 'Tue', long: 'Tuesday' },
  WED: { short: 'Wed', long: 'Wednesday' },
  THU: { short: 'Thu', long: 'Thursday' },
  FRI: { short: 'Fri', long: 'Friday' },
  SAT: { short: 'Sat', long: 'Saturday' },
  SUN: { short: 'Sun', long: 'Sunday' },
};

/** Minutes between two "HH:MM" times. */
export function minutesBetween(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return toMin(end) - toMin(start);
}

/** Percent with up to two decimals, no trailing zeros: 40 → "40%", 33.5 → "33.5%". */
export const formatPercent = (value: number) =>
  `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`;
