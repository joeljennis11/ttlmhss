import {
  appliesTo,
  resolveWorkingDay,
  sortWeekdays,
  weekdayOf,
  type ResolvedDay,
  type Weekday,
} from '@ttlmhss/shared';
import type { Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord } from '../config/config.repository.js';
import type { CalendarEntryRecord } from './calendar.repository.js';

/**
 * THE server-side answer to "is this class/section working on this date?" (BR-CAL-01…03).
 * Every feature that needs it — attendance, timetable lessons, later dashboards and reports —
 * loads one resolver per request and asks it; nobody reads `academic_years.working_days` directly.
 *
 * Resolution: weekly pattern of the year → the one date entry that applies to the class/section
 * (entries never overlap) → working or not. Dates outside the year are never working.
 */
export class CalendarResolver {
  private constructor(
    readonly year: AcademicYearRecord,
    private readonly entries: readonly CalendarEntryRecord[],
    private readonly classOfSection: ReadonlyMap<string, string>,
  ) {}

  static async load(repos: Repositories, year: AcademicYearRecord): Promise<CalendarResolver> {
    const [entries, sections] = await Promise.all([
      repos.calendar.listByYear(year.id),
      repos.classes.listSections(),
    ]);
    return new CalendarResolver(year, entries, new Map(sections.map((s) => [s.id, s.classId])));
  }

  /** For tests and callers that already hold the data. */
  static of(
    year: AcademicYearRecord,
    entries: readonly CalendarEntryRecord[],
    classOfSection: ReadonlyMap<string, string>,
  ): CalendarResolver {
    return new CalendarResolver(year, entries, classOfSection);
  }

  resolve(date: string, sectionId: string): ResolvedDay {
    const classId = this.classOfSection.get(sectionId) ?? '';
    return resolveWorkingDay(this.year, this.entries, date, classId, sectionId);
  }

  isWorking(date: string, sectionId: string): boolean {
    return this.resolve(date, sectionId).working;
  }

  /** Does any class work on this date (for "is this a school day at all" summaries)? */
  workingForAnyone(date: string): boolean {
    if (date < this.year.startDate || date > this.year.endDate) return false;
    const today = this.entries.filter((e) => e.date === date);
    if (today.some((e) => e.status === 'WORKING')) return true;
    if (!(this.year.workingDays ?? []).includes(weekdayOf(date))) return false;
    return !today.some((e) => e.scope === 'SCHOOL' && e.status === 'HOLIDAY');
  }

  /**
   * Weekdays on which this section may hold timetabled lessons: the weekly working days plus the
   * weekday of every special working date that applies to it (e.g. a working Sunday for 11–12).
   */
  lessonDays(sectionId: string): Weekday[] {
    const classId = this.classOfSection.get(sectionId) ?? '';
    const special = this.entries
      .filter((e) => e.status === 'WORKING' && appliesTo(e, classId, sectionId))
      .map((e) => weekdayOf(e.date));
    return sortWeekdays([...(this.year.workingDays ?? []), ...special]);
  }

  /** Human-readable reason a date is not working for a section (for error messages). */
  explain(date: string, sectionId: string, label: string): string {
    const r = this.resolve(date, sectionId);
    if (!r.inYear) return `${date} is not within ${this.year.label}.`;
    if (r.entry) return `${date} is a holiday for ${label} (${r.entry.reason}).`;
    return `${date} is not a working day for ${label} in ${this.year.label}.`;
  }
}
