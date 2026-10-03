import type { AuditLogRepository } from '../core/audit/audit-log.repository.js';
import type { AuthScopeRepository } from '../core/auth/scope.repository.js';
import type {
  CredentialRepository,
  SessionRepository,
  UserAccountRepository,
} from '../modules/auth/auth.repository.js';
import type {
  AcademicYearRepository,
  AttendancePolicyRepository,
  CategoryRepository,
  ClassRepository,
  ExamRepository,
  GradeSchemeRepository,
  PeriodRepository,
  RatingLabelRepository,
  RolePermissionRepository,
  SubjectRepository,
} from '../modules/config/config.repository.js';
import type {
  ClassTeacherRepository,
  EnrolmentRepository,
  PersonAccountRepository,
  StudentRepository,
  TeacherRepository,
  TeacherSubjectRepository,
} from '../modules/people/people.repository.js';
import type { AttendanceRepository } from '../modules/attendance/attendance.repository.js';
import type { TimetableRepository } from '../modules/timetable/timetable.repository.js';
import type { CalendarRepository } from '../modules/calendar/calendar.repository.js';
import type { MarksRepository } from '../modules/marks/marks.repository.js';
import type { SchoolSettingsRepository } from '../modules/school/school-settings.repository.js';

/**
 * THE data-access boundary.
 *
 * Services depend on these interfaces only. They never import Kysely, SQL, or a driver
 * (enforced by ESLint). The concrete implementation is chosen in src/data/index.ts from
 * DATABASE_URL, so the database provider can change without touching business logic.
 *
 * Each phase adds its repositories here as its features are built.
 */
export interface Repositories {
  readonly schoolSettings: SchoolSettingsRepository;
  readonly auditLogs: AuditLogRepository;
  // Phase 2 — authentication & authorization
  readonly userAccounts: UserAccountRepository;
  readonly credentials: CredentialRepository;
  readonly sessions: SessionRepository;
  readonly authScope: AuthScopeRepository;
  // Phase 4 — school configuration
  readonly academicYears: AcademicYearRepository;
  readonly classes: ClassRepository;
  readonly subjects: SubjectRepository;
  readonly periods: PeriodRepository;
  readonly attendancePolicy: AttendancePolicyRepository;
  readonly gradeSchemes: GradeSchemeRepository;
  readonly exams: ExamRepository;
  readonly behaviourCategories: CategoryRepository;
  readonly achievementCategories: CategoryRepository;
  readonly ratingLabels: RatingLabelRepository;
  readonly rolePermissions: RolePermissionRepository;
  // Phase 5 — students & teachers
  readonly students: StudentRepository;
  readonly enrolments: EnrolmentRepository;
  readonly teachers: TeacherRepository;
  readonly teacherSubjects: TeacherSubjectRepository;
  readonly classTeachers: ClassTeacherRepository;
  readonly personAccounts: PersonAccountRepository;
  // Phase 6 — timetable
  readonly timetable: TimetableRepository;
  // Phase 8A — academic calendar
  readonly calendar: CalendarRepository;
  // Phase 7 — attendance
  readonly attendance: AttendanceRepository;
  // Phase 8B — marks and results
  readonly marks: MarksRepository;
}

export interface MigrationState {
  name: string;
  executedAt: string | null;
}

/** Reproducible schema management (versioned migrations in src/data/kysely/migrations). */
export interface SchemaManager {
  status(): Promise<MigrationState[]>;
  pending(): Promise<string[]>;
  migrateToLatest(): Promise<string[]>;
  rollbackLast(): Promise<string | null>;
}

export interface DataStore {
  /** Repositories outside a transaction (each call is atomic on its own). */
  readonly repositories: Repositories;
  /**
   * Unit of work: everything done through `repos` commits together or not at all.
   * Use for multi-record operations (publish timetable, submit marks, promote class) and to keep
   * audit entries in the same transaction as the change they describe.
   */
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
  /** True when the database answers a trivial query. */
  ping(): Promise<boolean>;
  readonly schema: SchemaManager;
  close(): Promise<void>;
}
