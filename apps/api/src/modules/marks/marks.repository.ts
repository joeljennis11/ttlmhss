import type { MarkSheetStatus, MarkStructure } from '@ttlmhss/shared';

/**
 * Repository interfaces for marks (Phase 8B). Services depend on these; the Kysely adapter in
 * src/data/kysely/repositories/marks implements them.
 */

/** One sheet: an exam subject (exam × class × subject) in one section. */
export interface MarkSheetRecord {
  id: string;
  academicYearId: string;
  examId: string;
  examSubjectId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  /** The teacher explicitly authorised to enter this sheet's marks (null: administrators only). */
  entryTeacherId: string | null;
  status: MarkSheetStatus;
  revision: number;
  /** Settings used when the sheet was submitted (null before the first submission). */
  calculation: MarkStructure | null;
  submittedAt: string | null;
  submittedByName: string | null;
  unlockedAt: string | null;
  unlockedByName: string | null;
  unlockReason: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface NewMarkSheet {
  id: string;
  academicYearId: string;
  examId: string;
  examSubjectId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  entryTeacherId: string | null;
  createdBy: string | null;
}

export interface MarkSheetChanges {
  entryTeacherId?: string | null;
  status?: MarkSheetStatus;
  calculation?: MarkStructure | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
  unlockedAt?: string | null;
  unlockedBy?: string | null;
  unlockReason?: string | null;
}

/** Raw marks in hundredths (null = "-"), plus the values derived at submission. */
export interface MarkEntryRecord {
  id: string;
  markSheetId: string;
  academicYearId: string;
  sectionId: string;
  enrolmentId: string;
  studentId: string;
  theoryCm: number | null;
  internalCm: number | null;
  practicalCm: number | null;
  totalCm: number | null;
  normalizedCm: number | null;
  percentBp: number | null;
  grade: string | null;
  passed: boolean | null;
  updatedAt: string;
  updatedByName: string | null;
}

export type MarkEntryValues = Pick<MarkEntryRecord, 'theoryCm' | 'internalCm' | 'practicalCm'>;
export type MarkEntryDerived = Pick<
  MarkEntryRecord,
  'totalCm' | 'normalizedCm' | 'percentBp' | 'grade' | 'passed'
>;

export interface MarksRepository {
  findSheet(examSubjectId: string, sectionId: string): Promise<MarkSheetRecord | null>;
  sheetsForExam(examId: string): Promise<MarkSheetRecord[]>;
  sheetsForExamSubjects(examSubjectIds: string[]): Promise<MarkSheetRecord[]>;
  sheetsForTeacher(teacherId: string): Promise<MarkSheetRecord[]>;
  createSheet(sheet: NewMarkSheet, now: string): Promise<void>;
  /** Changes a sheet and advances its revision. */
  updateSheet(
    id: string,
    changes: MarkSheetChanges,
    actorUserId: string,
    now: string,
  ): Promise<void>;
  /**
   * Optimistic lock: advance the revision only if it is still `expected`. False when someone else
   * changed the sheet first (the caller refuses the stale update).
   */
  claimRevision(id: string, expected: number, actorUserId: string, now: string): Promise<boolean>;

  entriesForSheets(sheetIds: string[]): Promise<MarkEntryRecord[]>;
  entriesForStudent(studentId: string): Promise<MarkEntryRecord[]>;
  insertEntry(
    entry: Omit<MarkEntryRecord, 'updatedAt' | 'updatedByName' | keyof MarkEntryDerived> & {
      createdBy: string;
    },
    now: string,
  ): Promise<void>;
  /** New raw values; the derived values are cleared (they belong to a submission). */
  updateEntryValues(
    id: string,
    values: MarkEntryValues,
    actorUserId: string,
    now: string,
  ): Promise<void>;
  setEntryDerived(id: string, derived: MarkEntryDerived): Promise<void>;
  /** Remove a sheet that holds no marks (and its empty entry rows). */
  deleteEmptySheet(id: string): Promise<void>;
}
