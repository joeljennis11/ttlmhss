import { sql, type Kysely } from 'kysely';
import type { DatabaseConfig } from '../../config/database-url.js';
import type { DataStore, Repositories, SchemaManager } from '../data-store.js';
import { createKysely } from './connection.js';
import type { Database } from './database-schema.js';
import { translateDbError } from './db-errors.js';
import { KyselyAuditLogRepository } from './repositories/audit-log.repository.js';
import { KyselyAuthScopeRepository } from './repositories/auth-scope.repository.js';
import { KyselySessionRepository } from './repositories/session.repository.js';
import {
  KyselyCredentialRepository,
  KyselyUserAccountRepository,
} from './repositories/user-account.repository.js';
import { KyselySchoolSettingsRepository } from './repositories/school-settings.repository.js';
import {
  KyselyAttendancePolicyRepository,
  KyselyCategoryRepository,
  KyselyExamRepository,
  KyselyGradeSchemeRepository,
  KyselyRatingLabelRepository,
  KyselyRolePermissionRepository,
} from './repositories/config/rules.repositories.js';
import {
  KyselyAcademicYearRepository,
  KyselyClassRepository,
  KyselyPeriodRepository,
  KyselySubjectRepository,
} from './repositories/config/structure.repositories.js';
import {
  KyselyEnrolmentRepository,
  KyselyStudentRepository,
} from './repositories/people/student.repositories.js';
import {
  KyselyClassTeacherRepository,
  KyselyPersonAccountRepository,
  KyselyTeacherRepository,
  KyselyTeacherSubjectRepository,
} from './repositories/people/teacher.repositories.js';
import { KyselyAttendanceRepository } from './repositories/attendance/attendance.repository.js';
import { KyselyTimetableRepository } from './repositories/timetable/timetable.repository.js';
import { KyselyCalendarRepository } from './repositories/calendar/calendar.repository.js';
import { KyselyMarksRepository } from './repositories/marks/marks.repository.js';
import { KyselyBehaviourRepository } from './repositories/behaviour/behaviour.repository.js';
import { KyselyAchievementRepository } from './repositories/achievements/achievements.repository.js';
import { KyselyAnnouncementRepository } from './repositories/communication/announcements.repository.js';
import { KyselyRequestRepository } from './repositories/communication/requests.repository.js';
import { KyselyAnnualReportRepository } from './repositories/reports/annual-reports.repository.js';
import { KyselySchemaManager } from './schema-manager.js';

function createRepositories(db: Kysely<Database>): Repositories {
  return Object.freeze({
    schoolSettings: new KyselySchoolSettingsRepository(db),
    auditLogs: new KyselyAuditLogRepository(db),
    userAccounts: new KyselyUserAccountRepository(db),
    credentials: new KyselyCredentialRepository(db),
    sessions: new KyselySessionRepository(db),
    authScope: new KyselyAuthScopeRepository(db),
    academicYears: new KyselyAcademicYearRepository(db),
    classes: new KyselyClassRepository(db),
    subjects: new KyselySubjectRepository(db),
    periods: new KyselyPeriodRepository(db),
    attendancePolicy: new KyselyAttendancePolicyRepository(db),
    gradeSchemes: new KyselyGradeSchemeRepository(db),
    exams: new KyselyExamRepository(db),
    behaviourCategories: new KyselyCategoryRepository(db, 'behaviour_categories'),
    achievementCategories: new KyselyCategoryRepository(db, 'achievement_categories'),
    ratingLabels: new KyselyRatingLabelRepository(db),
    rolePermissions: new KyselyRolePermissionRepository(db),
    students: new KyselyStudentRepository(db),
    enrolments: new KyselyEnrolmentRepository(db),
    teachers: new KyselyTeacherRepository(db),
    teacherSubjects: new KyselyTeacherSubjectRepository(db),
    classTeachers: new KyselyClassTeacherRepository(db),
    personAccounts: new KyselyPersonAccountRepository(db),
    timetable: new KyselyTimetableRepository(db),
    calendar: new KyselyCalendarRepository(db),
    attendance: new KyselyAttendanceRepository(db),
    marks: new KyselyMarksRepository(db),
    behaviour: new KyselyBehaviourRepository(db),
    achievements: new KyselyAchievementRepository(db),
    announcements: new KyselyAnnouncementRepository(db),
    requests: new KyselyRequestRepository(db),
    annualReports: new KyselyAnnualReportRepository(db),
  });
}

export class KyselyDataStore implements DataStore {
  readonly repositories: Repositories;
  readonly schema: SchemaManager;

  constructor(private readonly db: Kysely<Database>) {
    this.repositories = createRepositories(db);
    this.schema = new KyselySchemaManager(db);
  }

  async transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute((trx) => work(createRepositories(trx)));
    } catch (error) {
      throw translateDbError(error);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }

  close(): Promise<void> {
    return this.db.destroy();
  }
}

export async function openKyselyDataStore(config: DatabaseConfig): Promise<DataStore> {
  return new KyselyDataStore(await createKysely(config));
}
