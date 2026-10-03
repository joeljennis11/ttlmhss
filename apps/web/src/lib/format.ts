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

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

/** A stored ISO timestamp → "3 Oct 2026, 14:05" in the school's time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

const safe = (format: Intl.DateTimeFormat, iso: string) => {
  const date = parse(iso);
  return Number.isNaN(date.getTime()) ? iso : format.format(date);
};

/** "2026-06-01" → "1 Jun 2026" (an unreadable value is shown as it is). */
export const formatDate = (iso: string) => safe(dateFormat, iso);
/** "2026-06-01" → "1 June 2026". */
export const formatLongDate = (iso: string) => safe(longDateFormat, iso);
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
