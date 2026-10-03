import type { CalendarDayStatus, CalendarScope } from '@ttlmhss/shared';

/** Repository interface for the academic calendar (Phase 8A); Kysely in data/kysely/repositories. */

export interface CalendarEntryRecord {
  id: string;
  academicYearId: string;
  date: string;
  status: CalendarDayStatus;
  scope: CalendarScope;
  classIds: string[];
  sectionIds: string[];
  reason: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Username (display only). */
  createdByName: string | null;
  updatedAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
}

export type CalendarEntryWrite = Pick<
  CalendarEntryRecord,
  | 'id'
  | 'academicYearId'
  | 'date'
  | 'status'
  | 'scope'
  | 'classIds'
  | 'sectionIds'
  | 'reason'
  | 'note'
>;

export interface CalendarRepository {
  /** Every entry of a year, by date. */
  listByYear(academicYearId: string): Promise<CalendarEntryRecord[]>;
  /** Entries of a year on one date. */
  listOnDate(academicYearId: string, date: string): Promise<CalendarEntryRecord[]>;
  find(id: string): Promise<CalendarEntryRecord | null>;
  create(entry: CalendarEntryWrite, actorUserId: string, now: string): Promise<void>;
  /** Replaces the entry's fields and targets. */
  update(entry: CalendarEntryWrite, actorUserId: string, now: string): Promise<void>;
  delete(id: string): Promise<void>;
}
