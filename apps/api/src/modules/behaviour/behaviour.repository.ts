/**
 * Repository interfaces for exam-based behaviour (Phase 9). Services depend on these; the Kysely
 * adapter in src/data/kysely/repositories/behaviour implements them.
 */
export type BehaviourSheetStatus = 'DRAFT' | 'SUBMITTED';

export interface BehaviourSheetRecord {
  id: string;
  academicYearId: string;
  examId: string;
  classId: string;
  sectionId: string;
  status: BehaviourSheetStatus;
  revision: number;
  submittedAt: string | null;
  submittedByName: string | null;
  updatedAt: string;
}

export interface BehaviourRatingRecord {
  categoryId: string;
  rating: number;
  /** The configured label of the rating when the sheet was submitted (null while a draft). */
  label: string | null;
}

export interface BehaviourAssessmentRecord {
  id: string;
  sheetId: string;
  academicYearId: string;
  sectionId: string;
  enrolmentId: string;
  studentId: string;
  remark: string | null;
  ratings: BehaviourRatingRecord[];
  updatedAt: string;
}

export interface BehaviourRepository {
  findSheet(examId: string, sectionId: string): Promise<BehaviourSheetRecord | null>;
  findSheetById(id: string): Promise<BehaviourSheetRecord | null>;
  createSheet(
    sheet: {
      id: string;
      academicYearId: string;
      examId: string;
      classId: string;
      sectionId: string;
      createdBy: string;
    },
    now: string,
  ): Promise<void>;
  /** Optimistic lock: advance the revision only if it is still `expected`. */
  claimRevision(id: string, expected: number, actorUserId: string, now: string): Promise<boolean>;
  markSubmitted(id: string, actorUserId: string, now: string): Promise<void>;
  assessmentsForSheet(sheetId: string): Promise<BehaviourAssessmentRecord[]>;
  assessmentsForStudent(studentId: string): Promise<BehaviourAssessmentRecord[]>;
  insertAssessment(
    a: {
      id: string;
      sheetId: string;
      academicYearId: string;
      sectionId: string;
      enrolmentId: string;
      studentId: string;
      remark: string | null;
      createdBy: string;
    },
    now: string,
  ): Promise<void>;
  updateRemark(id: string, remark: string | null, actorUserId: string, now: string): Promise<void>;
  /** Insert or replace one category's rating (label: snapshot, or null while a draft). */
  setRating(
    assessmentId: string,
    categoryId: string,
    rating: number,
    label: string | null,
    now: string,
  ): Promise<void>;
  deleteRating(assessmentId: string, categoryId: string): Promise<void>;
}
