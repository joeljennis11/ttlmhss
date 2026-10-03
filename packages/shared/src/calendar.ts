import { z } from 'zod';
import { AcademicYearStatus, Weekday, controlledValues } from './controlled-values.js';
import { weekdayOf } from './timetable.js';
import { IdSchema, IsoDateSchema, optionalText, requiredText } from './validation.js';

/*
 * Phase 8A — Academic (working-day) calendar.
 *
 * Two layers, resolved in one place (`resolveWorkingDay`):
 *   1. The academic year's WEEKLY PATTERN (Phase 4 working days) — the default.
 *   2. DATE ENTRIES: a date is a Working day or a Holiday for the whole school, some classes or some
 *      sections. An entry overrides the weekly pattern for the classes/sections it applies to.
 *
 * Entries never stack: on one date at most one entry may apply to any section (the whole school
 * overlaps everything; a class overlaps itself and its own sections). So the result is always
 * "the one entry that applies, else the weekly pattern" — no precedence rules to remember.
 */

export const CalendarDayStatus = controlledValues(['WORKING', 'HOLIDAY']);
export type CalendarDayStatus = (typeof CalendarDayStatus.values)[number];
export const CALENDAR_DAY_STATUS_LABELS: Record<CalendarDayStatus, string> = {
  WORKING: 'Working day',
  HOLIDAY: 'Holiday',
};

export const CalendarScope = controlledValues(['SCHOOL', 'CLASSES', 'SECTIONS']);
export type CalendarScope = (typeof CalendarScope.values)[number];

// ---- Applicability and resolution (pure; used by the API and the admin screen) ---------------

export interface CalendarTarget {
  scope: CalendarScope;
  classIds: readonly string[];
  sectionIds: readonly string[];
}

/** Does an entry apply to this class/section? */
export function appliesTo(t: CalendarTarget, classId: string, sectionId: string): boolean {
  if (t.scope === 'SCHOOL') return true;
  if (t.scope === 'CLASSES') return t.classIds.includes(classId);
  return t.sectionIds.includes(sectionId);
}

/**
 * Could two entries on the same date apply to the same section? `classOf` maps a section to its
 * class. Decided structurally (whole school ⊇ classes ⊇ their sections), so sections added later
 * can never create a hidden overlap.
 */
export function targetsOverlap(
  a: CalendarTarget,
  b: CalendarTarget,
  classOf: (sectionId: string) => string | undefined,
): boolean {
  if (a.scope === 'SCHOOL' || b.scope === 'SCHOOL') return true;
  if (a.scope === 'CLASSES' && b.scope === 'CLASSES') {
    return a.classIds.some((id) => b.classIds.includes(id));
  }
  if (a.scope === 'SECTIONS' && b.scope === 'SECTIONS') {
    return a.sectionIds.some((id) => b.sectionIds.includes(id));
  }
  const classes = a.scope === 'CLASSES' ? a : b;
  const sections = a.scope === 'SECTIONS' ? a : b;
  return sections.sectionIds.some((id) => {
    const cls = classOf(id);
    return cls !== undefined && classes.classIds.includes(cls);
  });
}

export interface ResolvedDay {
  date: string;
  day: Weekday;
  /** Is the date inside the academic year at all? */
  inYear: boolean;
  working: boolean;
  /** WEEKLY: the year's weekly pattern decided; ENTRY: a date entry decided. */
  source: 'WEEKLY' | 'ENTRY' | 'OUTSIDE_YEAR';
  entry: { id: string; status: CalendarDayStatus; reason: string } | null;
}

export interface CalendarYearFacts {
  startDate: string;
  endDate: string;
  workingDays: readonly Weekday[] | null;
}

export interface CalendarEntryFacts extends CalendarTarget {
  id: string;
  date: string;
  status: CalendarDayStatus;
  reason: string;
}

/**
 * THE rule (BR-CAL-01…03): is this class/section working on this date?
 * Weekly pattern → the one date entry that applies to the class/section (if any) → result.
 */
export function resolveWorkingDay(
  year: CalendarYearFacts,
  entries: readonly CalendarEntryFacts[],
  date: string,
  classId: string,
  sectionId: string,
): ResolvedDay {
  const day = weekdayOf(date);
  if (date < year.startDate || date > year.endDate) {
    return { date, day, inYear: false, working: false, source: 'OUTSIDE_YEAR', entry: null };
  }
  const entry = entries.find((e) => e.date === date && appliesTo(e, classId, sectionId));
  if (entry) {
    return {
      date,
      day,
      inYear: true,
      working: entry.status === 'WORKING',
      source: 'ENTRY',
      entry: { id: entry.id, status: entry.status, reason: entry.reason },
    };
  }
  return {
    date,
    day,
    inYear: true,
    working: (year.workingDays ?? []).includes(day),
    source: 'WEEKLY',
    entry: null,
  };
}

/** Weekdays in week order, without duplicates. */
export const sortWeekdays = (days: readonly Weekday[]): Weekday[] =>
  [...new Set(days)].sort((a, b) => Weekday.values.indexOf(a) - Weekday.values.indexOf(b));

/** Is the date a weekly working day (before any date entry)? */
export const weeklyWorking = (year: CalendarYearFacts, date: string) =>
  (year.workingDays ?? []).includes(weekdayOf(date));

/**
 * Classes from one class to another, inclusive, in the configured class order (display order, then
 * name) — never by comparing names, so "PreKG … UKG, 1 … 12" works. Either end may come first.
 */
export function classesInRange<T extends { id: string; name: string; displayOrder: number }>(
  classes: readonly T[],
  fromId: string,
  toId: string,
): T[] {
  const ordered = [...classes].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
  const i = ordered.findIndex((c) => c.id === fromId);
  const j = ordered.findIndex((c) => c.id === toId);
  if (i < 0 || j < 0) return [];
  return ordered.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// ---- Requests -----------------------------------------------------------------------------------

const ids = (what: string) =>
  z
    .array(IdSchema)
    .max(200)
    .default([])
    .refine((list) => new Set(list).size === list.length, {
      message: `Each ${what} only once`,
    });

export const CalendarEntryInputSchema = z
  .object({
    date: IsoDateSchema,
    status: z.enum(CalendarDayStatus.values, { message: 'Choose Working day or Holiday' }),
    scope: z.enum(CalendarScope.values, { message: 'Choose who this applies to' }),
    classIds: ids('class'),
    sectionIds: ids('section'),
    reason: requiredText(120, 'Reason'),
    note: optionalText(500, 'Note'),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'SCHOOL' && (v.classIds.length || v.sectionIds.length)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'The whole school needs no classes',
      });
    }
    if (v.scope === 'CLASSES') {
      if (v.classIds.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['classIds'], message: 'Choose at least one class' });
      }
      if (v.sectionIds.length) {
        ctx.addIssue({ code: 'custom', path: ['sectionIds'], message: 'Choose classes only' });
      }
    }
    if (v.scope === 'SECTIONS') {
      if (v.sectionIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['sectionIds'],
          message: 'Choose at least one section',
        });
      }
      if (v.classIds.length) {
        ctx.addIssue({ code: 'custom', path: ['classIds'], message: 'Choose sections only' });
      }
    }
  });
export type CalendarEntryInput = z.input<typeof CalendarEntryInputSchema>;

export const CalendarYearParamSchema = z.object({ yearId: IdSchema });

// ---- Views --------------------------------------------------------------------------------------

export const CalendarEntryViewSchema = z.object({
  id: z.string(),
  academicYearId: z.string(),
  date: z.string(),
  day: Weekday.schema,
  status: CalendarDayStatus.schema,
  scope: CalendarScope.schema,
  classes: z.array(z.object({ id: z.string(), name: z.string() })),
  sections: z.array(
    z.object({ id: z.string(), name: z.string(), classId: z.string(), className: z.string() }),
  ),
  /** Readable applicability, e.g. "Entire school", "Classes 11, 12", "10 A". */
  appliesTo: z.string(),
  /** What the weekly pattern would have said for this date. */
  weeklyWorking: z.boolean(),
  reason: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
});
export type CalendarEntryView = z.infer<typeof CalendarEntryViewSchema>;

export const CalendarViewSchema = z.object({
  academicYear: z.object({
    id: z.string(),
    label: z.string(),
    status: AcademicYearStatus.schema,
    startDate: z.string(),
    endDate: z.string(),
    workingDays: z.array(Weekday.schema).nullable(),
  }),
  /** Closed years are history: their calendar cannot change. */
  readOnly: z.boolean(),
  entries: z.array(CalendarEntryViewSchema),
  /** Classes in the configured order with their sections (for choosing who an entry applies to). */
  classes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      displayOrder: z.number(),
      active: z.boolean(),
      sections: z.array(z.object({ id: z.string(), name: z.string(), active: z.boolean() })),
    }),
  ),
});
export type CalendarView = z.infer<typeof CalendarViewSchema>;
