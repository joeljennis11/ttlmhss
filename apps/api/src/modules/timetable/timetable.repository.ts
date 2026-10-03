import type { RecordStatus, TimetableStatus, Weekday } from '@ttlmhss/shared';

/**
 * Repository interfaces for the timetable (Phase 6). Services depend on these; the Kysely adapter in
 * src/data/kysely/repositories/timetable implements them.
 */

export interface TimetableVersionRecord {
  id: string;
  academicYearId: string;
  versionNumber: number;
  status: TimetableStatus;
  entryCount: number;
  createdAt: string;
  createdBy: string | null;
  /** Username of the account (display only). */
  createdByName: string | null;
  updatedAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  publishedByName: string | null;
  supersededAt: string | null;
}

/** An entry with the names and statuses of everything it points to (for views and validation). */
export interface TimetableEntryRecord {
  id: string;
  versionId: string;
  academicYearId: string;
  day: Weekday;
  periodId: string;
  sectionId: string;
  sectionName: string;
  sectionStatus: RecordStatus;
  classId: string;
  className: string;
  classStatus: RecordStatus;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  subjectStatus: RecordStatus;
  teacherId: string;
  teacherName: string;
  staffCode: string;
  teacherStatus: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewTimetableEntry {
  id: string;
  versionId: string;
  academicYearId: string;
  day: Weekday;
  periodId: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
}

export interface EntryFilter {
  sectionId?: string;
  teacherId?: string;
  day?: Weekday;
}

export interface TimetableRepository {
  findVersion(id: string): Promise<TimetableVersionRecord | null>;
  /** The year's DRAFT or PUBLISHED version (each is unique per year). */
  versionWithStatus(
    academicYearId: string,
    status: 'DRAFT' | 'PUBLISHED',
  ): Promise<TimetableVersionRecord | null>;
  /**
   * The version that was live at a moment: the newest PUBLISHED or SUPERSEDED version published
   * before `beforeIso` (Phase 7 — attendance for a date uses the timetable in force on that date).
   */
  versionInForce(academicYearId: string, beforeIso: string): Promise<TimetableVersionRecord | null>;
  /** Newest first. */
  listVersions(academicYearId: string): Promise<TimetableVersionRecord[]>;
  nextVersionNumber(academicYearId: string): Promise<number>;
  createDraft(
    v: { id: string; academicYearId: string; versionNumber: number },
    actorUserId: string,
    now: string,
  ): Promise<void>;
  /** Record who last changed the draft and when. */
  touch(versionId: string, actorUserId: string, now: string): Promise<void>;
  markPublished(versionId: string, actorUserId: string, now: string): Promise<void>;
  markSuperseded(versionId: string, now: string): Promise<void>;
  /** Only an unpublished draft may be deleted (its entries first). */
  deleteDraft(versionId: string): Promise<void>;

  /** Copy every entry of one version into another (new ids); returns how many were copied. */
  copyEntries(
    fromVersionId: string,
    toVersionId: string,
    actorUserId: string,
    now: string,
  ): Promise<number>;
  listEntries(versionId: string, filter?: EntryFilter): Promise<TimetableEntryRecord[]>;
  findEntry(id: string): Promise<TimetableEntryRecord | null>;
  /** The entry holding a section's slot, or a teacher's slot, in a version. */
  sectionSlot(
    versionId: string,
    sectionId: string,
    day: Weekday,
    periodId: string,
  ): Promise<TimetableEntryRecord | null>;
  teacherSlot(
    versionId: string,
    teacherId: string,
    day: Weekday,
    periodId: string,
  ): Promise<TimetableEntryRecord | null>;
  insertEntry(entry: NewTimetableEntry, actorUserId: string, now: string): Promise<void>;
  updateEntry(
    id: string,
    changes: Partial<Pick<NewTimetableEntry, 'day' | 'periodId' | 'subjectId' | 'teacherId'>>,
    actorUserId: string,
    now: string,
  ): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  deleteEntries(versionId: string): Promise<void>;

  /** Entries in any version (history included) that use a period. */
  countForPeriod(periodId: string): Promise<number>;
  /** Entries in the DRAFT or PUBLISHED version of any year that use this Teacher → Subject pair. */
  countLiveForTeacherSubject(teacherId: string, subjectId: string): Promise<number>;
  /** Any timetable version or entry anywhere for the teacher (history included). */
  countForTeacher(teacherId: string): Promise<number>;
  /** Academic years that have any timetable version. */
  yearIdsInUse(): Promise<Set<string>>;
}
