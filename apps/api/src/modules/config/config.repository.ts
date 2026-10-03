import type {
  AcademicYearStatus,
  AttendanceLockMode,
  ConfigurableRole,
  ExamStage,
  PeriodKind,
  Permission,
  RankScope,
  RecordStatus,
  Weekday,
} from '@ttlmhss/shared';

/*
 * Repository interfaces for school configuration (Phase 4). Services depend on these; the Kysely
 * implementations live in src/data/kysely/repositories/config/. Percentages cross this boundary as
 * integer hundredths ("bp") so no floating-point value is ever stored.
 */

// ---- Academic years ---------------------------------------------------------------------------

export interface AcademicYearRecord {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: AcademicYearStatus;
  workingDays: Weekday[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcademicYearRepository {
  list(): Promise<AcademicYearRecord[]>;
  find(id: string): Promise<AcademicYearRecord | null>;
  findByLabel(label: string): Promise<AcademicYearRecord | null>;
  findCurrent(): Promise<AcademicYearRecord | null>;
  create(record: AcademicYearRecord): Promise<void>;
  update(
    id: string,
    changes: Partial<
      Pick<AcademicYearRecord, 'label' | 'startDate' | 'endDate' | 'status' | 'workingDays'>
    >,
    now: string,
  ): Promise<void>;
  delete(id: string): Promise<void>;
  /** Ids of years that other records belong to (periods, exams, enrolments, assignments). */
  idsInUse(): Promise<Set<string>>;
}

// ---- Classes & sections -------------------------------------------------------------------------

export interface ClassRecord {
  id: string;
  name: string;
  displayOrder: number;
  status: RecordStatus;
}

export interface SectionRecord {
  id: string;
  classId: string;
  name: string;
  status: RecordStatus;
}

export interface ClassRepository {
  listClasses(): Promise<ClassRecord[]>;
  listSections(): Promise<SectionRecord[]>;
  findClass(id: string): Promise<ClassRecord | null>;
  findClassByName(name: string): Promise<ClassRecord | null>;
  createClass(record: ClassRecord, now: string): Promise<void>;
  updateClass(id: string, changes: Partial<Omit<ClassRecord, 'id'>>, now: string): Promise<void>;
  findSection(id: string): Promise<SectionRecord | null>;
  findSectionByName(classId: string, name: string): Promise<SectionRecord | null>;
  createSection(record: SectionRecord, now: string): Promise<void>;
  updateSection(
    id: string,
    changes: Partial<Pick<SectionRecord, 'name' | 'status'>>,
    now: string,
  ): Promise<void>;
}

// ---- Subjects -------------------------------------------------------------------------------------

export interface SubjectRecord {
  id: string;
  name: string;
  code: string | null;
  displayOrder: number;
  status: RecordStatus;
}

export interface SubjectRepository {
  list(): Promise<SubjectRecord[]>;
  find(id: string): Promise<SubjectRecord | null>;
  findByName(name: string): Promise<SubjectRecord | null>;
  findByCode(code: string): Promise<SubjectRecord | null>;
  create(record: SubjectRecord, now: string): Promise<void>;
  update(id: string, changes: Partial<Omit<SubjectRecord, 'id'>>, now: string): Promise<void>;
}

// ---- Periods & breaks -----------------------------------------------------------------------------

export interface PeriodRecord {
  id: string;
  academicYearId: string;
  kind: PeriodKind;
  periodNumber: number | null;
  label: string;
  startTime: string;
  endTime: string;
  status: RecordStatus;
}

export interface PeriodRepository {
  /** Slots of a year in day order. */
  listByYear(academicYearId: string): Promise<PeriodRecord[]>;
  find(id: string): Promise<PeriodRecord | null>;
  create(record: PeriodRecord, now: string): Promise<void>;
  update(
    id: string,
    changes: Partial<
      Pick<PeriodRecord, 'periodNumber' | 'label' | 'startTime' | 'endTime' | 'status'>
    >,
    now: string,
  ): Promise<void>;
  delete(id: string): Promise<void>;
  /** Re-number the stored sequence of a year's slots by start time (day order). */
  resequence(academicYearId: string, now: string): Promise<void>;
}

// ---- Attendance policy ------------------------------------------------------------------------------

export interface AttendancePolicyRecord {
  mode: AttendanceLockMode;
  cutoffDay: number;
  updatedAt: string;
}

export interface AttendancePolicyRepository {
  get(): Promise<AttendancePolicyRecord | null>;
  save(policy: Omit<AttendancePolicyRecord, 'updatedAt'>, now: string): Promise<void>;
}

// ---- Grade scales -----------------------------------------------------------------------------------

export interface GradeBandRecord {
  label: string;
  minBp: number;
  remark: string | null;
}

export interface GradeSchemeRecord {
  id: string;
  name: string;
  status: RecordStatus;
  bands: GradeBandRecord[];
  updatedAt: string;
}

export interface GradeSchemeRepository {
  list(): Promise<GradeSchemeRecord[]>;
  find(id: string): Promise<GradeSchemeRecord | null>;
  findByName(name: string): Promise<GradeSchemeRecord | null>;
  /** Insert or replace a scale together with all of its bands. */
  save(record: Omit<GradeSchemeRecord, 'updatedAt'>, now: string, isNew: boolean): Promise<void>;
  delete(id: string): Promise<void>;
  /** Ids of scales referenced by exams or exam subjects. */
  idsInUse(): Promise<Set<string>>;
}

// ---- Exams ------------------------------------------------------------------------------------------

export interface ExamRecord {
  id: string;
  academicYearId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  weightageBp: number;
  gradeSchemeId: string | null;
  rankScope: RankScope;
  displayOrder: number;
  status: RecordStatus;
  /** Phase 8B marks lifecycle. */
  stage: ExamStage;
  description: string | null;
}

export interface ExamSubjectRecord {
  id: string;
  examId: string;
  classId: string;
  subjectId: string;
  theoryMax: number;
  internalMax: number | null;
  practicalMax: number | null;
  passMarks: number;
  normalizedMax: number | null;
  includeInResult: boolean;
  gradeSchemeId: string | null;
}

export interface ExamRepository {
  listByYear(academicYearId: string): Promise<(ExamRecord & { subjectCount: number })[]>;
  find(id: string): Promise<ExamRecord | null>;
  findByName(academicYearId: string, name: string): Promise<ExamRecord | null>;
  create(record: ExamRecord, now: string): Promise<void>;
  update(
    id: string,
    changes: Partial<Omit<ExamRecord, 'id' | 'academicYearId'>>,
    now: string,
  ): Promise<void>;
  delete(id: string): Promise<void>;
  countSubjects(examId: string): Promise<number>;
  /** Every class × subject row of the exam. */
  listAllSubjects(examId: string): Promise<ExamSubjectRecord[]>;
  findSubject(id: string): Promise<ExamSubjectRecord | null>;
  listSubjects(examId: string, classId: string): Promise<ExamSubjectRecord[]>;
  insertSubject(record: ExamSubjectRecord, now: string): Promise<void>;
  updateSubject(
    id: string,
    changes: Omit<ExamSubjectRecord, 'id' | 'examId' | 'classId' | 'subjectId'>,
    now: string,
  ): Promise<void>;
  deleteSubject(id: string): Promise<void>;
}

// ---- Behaviour & achievement categories, rating labels ---------------------------------------------

export interface CategoryRecord {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  status: RecordStatus;
}

export interface CategoryRepository {
  list(): Promise<CategoryRecord[]>;
  find(id: string): Promise<CategoryRecord | null>;
  findByName(name: string): Promise<CategoryRecord | null>;
  create(record: CategoryRecord, now: string): Promise<void>;
  update(id: string, changes: Partial<Omit<CategoryRecord, 'id'>>, now: string): Promise<void>;
}

export interface RatingLabelRecord {
  rating: number;
  label: string;
  description: string | null;
}

export interface RatingLabelRepository {
  list(): Promise<RatingLabelRecord[]>;
  replaceAll(labels: RatingLabelRecord[], now: string): Promise<void>;
}

// ---- Role permission overrides -------------------------------------------------------------------------

export interface PermissionOverride {
  role: ConfigurableRole;
  permission: Permission;
  effect: 'GRANT' | 'REVOKE';
}

export interface RolePermissionRepository {
  /** Stored overrides. Unknown roles/permissions (e.g. removed from the code) are skipped. */
  list(): Promise<PermissionOverride[]>;
  replaceForRole(
    role: ConfigurableRole,
    overrides: PermissionOverride[],
    updatedBy: string | null,
    now: string,
  ): Promise<void>;
}
