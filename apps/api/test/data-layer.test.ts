import {
  AcademicYearStatus,
  EnrolmentStatus,
  PeriodKind,
  RecordStatus,
  TimetableStatus,
  UserRole,
  Weekday,
} from '@ttlmhss/shared';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditRecorder } from '../src/core/audit/audit-recorder.js';
import { ConflictError, InternalError } from '../src/core/errors/app-errors.js';
import type { Database } from '../src/data/kysely/database-schema.js';
import { classifyDbError, guard } from '../src/data/kysely/db-errors.js';
import type { KyselyDataStore } from '../src/data/kysely/kysely-data-store.js';
import { fixedClock, openTestDatabase, type TestDriver } from './support/test-harness.js';

/*
 * Every assertion here runs against BOTH SQLite and PostgreSQL (PGlite). This is the evidence
 * that the schema and data layer are provider-independent (docs/decisions.md D-04).
 *
 * The rows inserted below are TEST FIXTURES ONLY (obviously synthetic names). They are created
 * in throwaway in-memory databases and are not school data.
 */
const NOW = '2026-06-01T09:00:00.000Z';
const ts = { created_at: NOW, updated_at: NOW };

function fixtures(db: Kysely<Database>) {
  return {
    year: async (status: string = 'UPCOMING', label = `Y-${randomUUID().slice(0, 8)}`) => {
      const id = randomUUID();
      await db
        .insertInto('academic_years')
        .values({ id, label, start_date: '2026-06-01', end_date: '2027-04-30', status, ...ts })
        .execute();
      return id;
    },
    classRow: async (name = `Class-${randomUUID().slice(0, 6)}`, status = 'ACTIVE') => {
      const id = randomUUID();
      await db
        .insertInto('classes')
        .values({ id, name, display_order: 1, status, ...ts })
        .execute();
      return id;
    },
    section: async (classId: string, name = 'A') => {
      const id = randomUUID();
      await db
        .insertInto('sections')
        .values({ id, class_id: classId, name, status: 'ACTIVE', ...ts })
        .execute();
      return id;
    },
    user: async (role: string = 'STUDENT', username = `test.user.${randomUUID().slice(0, 8)}`) => {
      const id = randomUUID();
      await db
        .insertInto('users')
        .values({ id, username, role, status: 'ACTIVE', ...ts })
        .execute();
      return id;
    },
    student: async (userId: string) => {
      const id = randomUUID();
      await db
        .insertInto('students')
        .values({
          id,
          user_id: userId,
          admission_number: `TEST-${randomUUID().slice(0, 8)}`,
          full_name: 'Test Student',
          date_of_birth: null,
          photo_path: null,
          status: 'ACTIVE',
          ...ts,
        })
        .execute();
      return id;
    },
    enrolment: async (
      studentId: string,
      yearId: string,
      sectionId: string,
      status = 'ACTIVE',
      roll: string | null = null,
    ) => {
      const id = randomUUID();
      await db
        .insertInto('enrolments')
        .values({
          id,
          student_id: studentId,
          academic_year_id: yearId,
          section_id: sectionId,
          roll_number: roll,
          status,
          started_on: '2026-06-01',
          ended_on: null,
          ...ts,
        })
        .execute();
      return id;
    },
    period: async (
      yearId: string,
      values: { sequence: number; kind: string; period_number: number | null },
    ) =>
      db
        .insertInto('periods')
        .values({
          id: randomUUID(),
          academic_year_id: yearId,
          label: 'Test',
          start_time: '09:00',
          end_time: '09:45',
          status: 'ACTIVE',
          ...values,
          ...ts,
        })
        .execute(),
  };
}

describe.each<TestDriver>(['sqlite', 'postgres'])('data layer on %s', (driver) => {
  let db: Kysely<Database>;
  let store: KyselyDataStore;
  let f: ReturnType<typeof fixtures>;

  beforeEach(async () => {
    ({ db, store } = await openTestDatabase(driver));
    f = fixtures(db);
  });
  afterEach(async () => {
    await store.close();
  });

  describe('schema management', () => {
    const ALL = [
      '0001_foundation',
      '0002_school_identity',
      '0003_authentication',
      '0004_school_logo',
      '0005_school_configuration',
      '0006_people',
      '0007_timetable',
      '0008_attendance',
      '0009_academic_calendar',
      '0010_marks',
      '0011_behaviour_achievements',
      '0012_announcements_requests',
      '0013_annual_reports',
      '0014_timetable_change_requests',
    ];

    it('migrates an empty database to the latest version', async () => {
      expect(await store.schema.pending()).toEqual([]);
      const status = await store.schema.status();
      expect(status.map((m) => m.name)).toEqual(ALL);
      expect(status.every((m) => m.executedAt !== null)).toBe(true);
      expect(await store.ping()).toBe(true);
    });

    it('every migration rolls back cleanly and re-applies (schema is reproducible)', async () => {
      expect(await store.schema.rollbackLast()).toBe('0014_timetable_change_requests');
      expect(await store.schema.rollbackLast()).toBe('0013_annual_reports');
      expect(await store.schema.rollbackLast()).toBe('0012_announcements_requests');
      expect(await store.schema.rollbackLast()).toBe('0011_behaviour_achievements');
      expect(await store.schema.rollbackLast()).toBe('0010_marks');
      expect(await store.schema.rollbackLast()).toBe('0009_academic_calendar');
      expect(await store.schema.rollbackLast()).toBe('0008_attendance');
      expect(await store.schema.rollbackLast()).toBe('0007_timetable');
      expect(await store.schema.rollbackLast()).toBe('0006_people');
      expect(await store.schema.rollbackLast()).toBe('0005_school_configuration');
      expect(await store.schema.rollbackLast()).toBe('0004_school_logo');
      expect((await store.repositories.schoolSettings.get())?.logoPath).toBeNull();
      expect(await store.schema.rollbackLast()).toBe('0003_authentication');
      expect(await store.schema.rollbackLast()).toBe('0002_school_identity');
      expect(await store.repositories.schoolSettings.get()).toBeNull();
      expect(await store.schema.rollbackLast()).toBe('0001_foundation');
      expect(await store.schema.rollbackLast()).toBeNull();
      expect(await store.schema.pending()).toEqual(ALL);
      expect(await store.schema.migrateToLatest()).toEqual(ALL);
      expect(await store.repositories.schoolSettings.get()).not.toBeNull();
    });
  });

  describe('repositories', () => {
    it('reads the school identity reference data', async () => {
      expect(await store.repositories.schoolSettings.get()).toMatchObject({
        shortName: 'TTLMHSS',
        fullName: 'Thiruthangal Lions Matriculation Higher Secondary School',
        primaryColor: '#003300',
        logoPath: '/brand/ttlmhss-logo.webp',
      });
    });

    it('audit log is written through the recorder with sensitive values redacted', async () => {
      const actor = await f.user('ADMIN', 'test.admin');
      const recorder = new AuditRecorder(store.repositories.auditLogs, fixedClock());
      await recorder.record(
        {
          action: 'test.updated',
          entityType: 'test_entity',
          entityId: 'e-1',
          before: { status: 'P', password: 'old' },
          after: { status: 'A', nested: { token: 'abc' } },
          reason: 'Correction',
        },
        { actorUserId: actor, requestId: 'req-1' },
      );
      const [entry, ...rest] = await store.repositories.auditLogs.listForEntity(
        'test_entity',
        'e-1',
        10,
      );
      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({
        actorUserId: actor,
        action: 'test.updated',
        occurredAt: '2026-06-01T09:00:00.000Z',
        before: { status: 'P', password: '[REDACTED]' },
        after: { status: 'A', nested: { token: '[REDACTED]' } },
        reason: 'Correction',
        requestId: 'req-1',
      });
    });

    it('a failed unit of work rolls back every write, including audit entries', async () => {
      const recorder = (repos: typeof store.repositories) =>
        new AuditRecorder(repos.auditLogs, fixedClock());
      await expect(
        store.transaction(async (repos) => {
          await recorder(repos).record(
            { action: 'test.step', entityType: 'tx', entityId: 'tx-1' },
            { actorUserId: null, requestId: null },
          );
          throw new ConflictError('second step failed');
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await store.repositories.auditLogs.listForEntity('tx', 'tx-1', 10)).toEqual([]);

      await store.transaction(async (repos) => {
        await recorder(repos).record(
          { action: 'test.step', entityType: 'tx', entityId: 'tx-1' },
          { actorUserId: null, requestId: null },
        );
      });
      expect(await store.repositories.auditLogs.listForEntity('tx', 'tx-1', 10)).toHaveLength(1);
    });
  });

  describe('integrity constraints', () => {
    it('unique values are reported as ConflictError', async () => {
      await f.classRow('Dup');
      await expect(guard(() => f.classRow('Dup'))).rejects.toBeInstanceOf(ConflictError);
    });

    it('referenced records cannot be hard-deleted (history is protected)', async () => {
      const classId = await f.classRow();
      await f.section(classId);
      await expect(
        guard(() => db.deleteFrom('classes').where('id', '=', classId).execute()),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(
        await db.selectFrom('classes').select('id').where('id', '=', classId).execute(),
      ).toHaveLength(1);
    });

    it('rejects references to records that do not exist', async () => {
      await expect(guard(() => f.section(randomUUID()))).rejects.toBeInstanceOf(ConflictError);
    });

    it('controlled values are enforced by the database (no arbitrary strings)', async () => {
      await expect(guard(() => f.classRow(undefined, 'DELETED'))).rejects.toBeInstanceOf(
        InternalError,
      );
      await expect(guard(() => f.user('CLASS_TEACHER'))).rejects.toBeInstanceOf(InternalError);
      await expect(guard(() => f.year('ARCHIVED'))).rejects.toBeInstanceOf(InternalError);
    });

    it('accepts every controlled value currently defined in @ttlmhss/shared', async () => {
      for (const role of UserRole.values) await f.user(role);
      for (const status of RecordStatus.values) await f.classRow(undefined, status);
      for (const status of AcademicYearStatus.values) await f.year(status);
      const yearId = await f.year();
      const sectionId = await f.section(await f.classRow());
      for (const status of EnrolmentStatus.values) {
        await f.enrolment(await f.student(await f.user()), yearId, sectionId, status);
      }
      expect(PeriodKind.values).toEqual(['LESSON', 'BREAK']);
      await f.period(yearId, { sequence: 1, kind: 'LESSON', period_number: 1 });
      await f.period(yearId, { sequence: 2, kind: 'BREAK', period_number: null });
    });

    it('allows only one CURRENT academic year', async () => {
      await f.year('CURRENT');
      await f.year('CLOSED');
      await f.year('CLOSED');
      await expect(guard(() => f.year('CURRENT'))).rejects.toBeInstanceOf(ConflictError);
    });

    it('academic year must end after it starts', async () => {
      await expect(
        guard(() =>
          db
            .insertInto('academic_years')
            .values({
              id: randomUUID(),
              label: 'bad',
              start_date: '2027-01-01',
              end_date: '2026-01-01',
              status: 'UPCOMING',
              ...ts,
            })
            .execute(),
        ),
      ).rejects.toBeInstanceOf(InternalError);
    });

    it('periods: lessons are numbered, breaks are not, no duplicate slots per year', async () => {
      const yearId = await f.year();
      await expect(
        guard(() => f.period(yearId, { sequence: 1, kind: 'BREAK', period_number: 3 })),
      ).rejects.toBeInstanceOf(InternalError);
      await expect(
        guard(() => f.period(yearId, { sequence: 1, kind: 'LESSON', period_number: null })),
      ).rejects.toBeInstanceOf(InternalError);
      await f.period(yearId, { sequence: 1, kind: 'LESSON', period_number: 1 });
      await f.period(yearId, { sequence: 2, kind: 'BREAK', period_number: null });
      await f.period(yearId, { sequence: 3, kind: 'BREAK', period_number: null });
      await expect(
        guard(() => f.period(yearId, { sequence: 4, kind: 'LESSON', period_number: 1 })),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        guard(() => f.period(yearId, { sequence: 1, kind: 'LESSON', period_number: 2 })),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('usernames are stored lowercase so uniqueness is case-insensitive everywhere', async () => {
      await expect(guard(() => f.user('ADMIN', 'Test.Admin'))).rejects.toBeInstanceOf(
        InternalError,
      );
    });

    it('school settings is a single-row table', async () => {
      await expect(
        guard(() =>
          db
            .insertInto('school_settings')
            .values({
              id: 'second',
              short_name: 'X',
              full_name: 'X',
              primary_color: '#000000',
              logo_path: null,
              address: null,
              phone: null,
              email: null,
              ...ts,
            })
            .execute(),
        ),
      ).rejects.toBeInstanceOf(InternalError);
    });
  });

  describe('timetable constraints (Phase 6)', () => {
    async function setup() {
      const yearId = await f.year();
      const sectionA = await f.section(await f.classRow());
      const sectionB = await f.section(await f.classRow());
      const periodId = randomUUID();
      await db
        .insertInto('periods')
        .values({
          id: periodId,
          academic_year_id: yearId,
          sequence: 1,
          period_number: 1,
          kind: 'LESSON',
          label: 'Period 1',
          start_time: '09:00',
          end_time: '09:45',
          status: 'ACTIVE',
          ...ts,
        })
        .execute();
      const subjectId = randomUUID();
      await db
        .insertInto('subjects')
        .values({
          id: subjectId,
          name: `Sub-${subjectId.slice(0, 6)}`,
          code: null,
          display_order: 1,
          status: 'ACTIVE',
          ...ts,
        })
        .execute();
      const teacher = async () => {
        const id = randomUUID();
        await db
          .insertInto('teachers')
          .values({
            id,
            user_id: await f.user('TEACHER'),
            staff_code: `T-${id.slice(0, 8)}`,
            full_name: 'Test Teacher',
            phone: null,
            email: null,
            status: 'ACTIVE',
            gender: null,
            date_of_birth: null,
            address: null,
            designation: null,
            qualification: null,
            joining_date: null,
            ...ts,
          })
          .execute();
        return id;
      };
      const version = async (status: string, number: number) => {
        const id = randomUUID();
        await db
          .insertInto('timetable_versions')
          .values({
            id,
            academic_year_id: yearId,
            version_number: number,
            status,
            created_by: null,
            updated_by: null,
            published_by: null,
            published_at: status === 'DRAFT' ? null : NOW,
            superseded_at: null,
            ...ts,
          })
          .execute();
        return id;
      };
      const entry = (versionId: string, sectionId: string, teacherId: string, day = 'MON') =>
        db
          .insertInto('timetable_entries')
          .values({
            id: randomUUID(),
            version_id: versionId,
            academic_year_id: yearId,
            day,
            period_id: periodId,
            section_id: sectionId,
            subject_id: subjectId,
            teacher_id: teacherId,
            created_by: null,
            updated_by: null,
            ...ts,
          })
          .execute();
      return { yearId, sectionA, sectionB, periodId, teacher, version, entry };
    }

    it('one draft and one published version per year; every status is accepted', async () => {
      const t = await setup();
      expect(TimetableStatus.values).toEqual(['DRAFT', 'PUBLISHED', 'SUPERSEDED']);
      await t.version('SUPERSEDED', 1);
      await t.version('SUPERSEDED', 2);
      await t.version('PUBLISHED', 3);
      await t.version('DRAFT', 4);
      await expect(guard(() => t.version('DRAFT', 5))).rejects.toBeInstanceOf(ConflictError);
      await expect(guard(() => t.version('PUBLISHED', 6))).rejects.toBeInstanceOf(ConflictError);
      await expect(guard(() => t.version('SUPERSEDED', 3))).rejects.toBeInstanceOf(ConflictError);
      await expect(guard(() => t.version('ARCHIVED', 7))).rejects.toBeInstanceOf(InternalError);
    });

    it('blocks teacher double-booking and class collisions within a version', async () => {
      const t = await setup();
      const v1 = await t.version('PUBLISHED', 1);
      const v2 = await t.version('DRAFT', 2);
      const arun = await t.teacher();
      const priya = await t.teacher();
      await t.entry(v1, t.sectionA, arun);
      // BR-TT-04: same teacher, same day + period, another class.
      await expect(guard(() => t.entry(v1, t.sectionB, arun))).rejects.toBeInstanceOf(
        ConflictError,
      );
      // BR-TT-05: same class, same day + period, another teacher.
      await expect(guard(() => t.entry(v1, t.sectionA, priya))).rejects.toBeInstanceOf(
        ConflictError,
      );
      // Another day, another class, or another version is fine.
      await t.entry(v1, t.sectionB, priya);
      await t.entry(v1, t.sectionA, arun, 'TUE');
      await t.entry(v2, t.sectionA, arun);
      for (const day of Weekday.values) await t.entry(v2, t.sectionB, priya, day);
      await expect(guard(() => t.entry(v2, t.sectionB, arun, 'FUNDAY'))).rejects.toBeInstanceOf(
        InternalError,
      );
      // A period used by a timetable (history included) cannot be deleted.
      await expect(
        guard(() => db.deleteFrom('periods').where('id', '=', t.periodId).execute()),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('authentication repositories', () => {
    it('credentials live outside users, upsert cleanly and enforce the status values', async () => {
      const userId = await f.user('ADMIN', 'test.admin');
      const creds = store.repositories.credentials;
      expect(await creds.find(userId)).toBeNull();
      await creds.save(userId, '$argon2id$v=19$m=19456,t=2,p=1$fakefakefake', 'TEMPORARY', NOW);
      await creds.save(
        userId,
        '$argon2id$v=19$m=19456,t=2,p=1$otherotherother',
        'SET',
        '2026-06-02T00:00:00.000Z',
      );
      expect(await creds.find(userId)).toMatchObject({
        passwordStatus: 'SET',
        passwordChangedAt: '2026-06-02T00:00:00.000Z',
      });
      expect(await db.selectFrom('user_credentials').select('user_id').execute()).toHaveLength(1);
      await expect(
        guard(() => db.updateTable('user_credentials').set({ password_status: 'NONE' }).execute()),
      ).rejects.toBeInstanceOf(InternalError);
      // A user referenced by credentials cannot be deleted.
      await expect(
        guard(() => db.deleteFrom('users').where('id', '=', userId).execute()),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('user accounts resolve their linked profile and display name', async () => {
      const userId = await f.user('STUDENT', 'test.student');
      const studentId = await f.student(userId);
      const account = await store.repositories.userAccounts.findByUsername('test.student');
      expect(account).toEqual({
        id: userId,
        username: 'test.student',
        role: 'STUDENT',
        status: 'ACTIVE',
        displayName: 'Test Student',
        teacherId: null,
        studentId,
      });
      expect(await store.repositories.userAccounts.findByUsername('TEST.STUDENT')).toBeNull();
    });

    it('sessions: create, find by token hash, revoke, revoke-all and prune', async () => {
      const userId = await f.user('ADMIN', 'test.admin');
      const sessions = store.repositories.sessions;
      const make = (id: string, expiresAt = '2026-06-01T21:00:00.000Z') =>
        sessions.create({
          id,
          userId,
          tokenHash: `hash-${id}`,
          createdAt: NOW,
          lastSeenAt: NOW,
          expiresAt,
          ipAddress: null,
          userAgent: null,
        });
      await make('s1');
      await make('s2');
      await make('s3', '2026-06-01T10:00:00.000Z');
      await expect(guard(() => make('s1'))).rejects.toBeInstanceOf(ConflictError);

      expect(await sessions.findByTokenHash('hash-s1')).toMatchObject({
        id: 's1',
        userId,
        revokedAt: null,
      });
      await sessions.touch('s1', '2026-06-01T09:30:00.000Z');
      await sessions.revoke('s2', '2026-06-01T09:31:00.000Z', 'logout');
      expect((await sessions.findByTokenHash('hash-s2'))?.revokedAt).toBe(
        '2026-06-01T09:31:00.000Z',
      );
      expect(
        await sessions.revokeAllForUser(
          userId,
          '2026-06-01T09:32:00.000Z',
          'password_changed',
          's1',
        ),
      ).toBe(1);

      await sessions.pruneForUser(userId, '2026-06-01T11:00:00.000Z');
      const left = await db.selectFrom('sessions').select(['id', 'last_seen_at']).execute();
      expect(left).toEqual([{ id: 's1', last_seen_at: '2026-06-01T09:30:00.000Z' }]);
    });

    it('scope queries return only ACTIVE assignments/enrolments in the CURRENT year', async () => {
      const current = await f.year('CURRENT');
      const closed = await f.year('CLOSED');
      const classId = await f.classRow();
      const a = await f.section(classId, 'A');
      const b = await f.section(classId, 'B');
      const teacherUser = await f.user('TEACHER');
      const teacherId = randomUUID();
      await db
        .insertInto('teachers')
        .values({
          id: teacherId,
          user_id: teacherUser,
          staff_code: 'TEST-T1',
          full_name: 'T',
          phone: null,
          email: null,
          status: 'ACTIVE',
          ...ts,
        })
        .execute();
      const assign = (yearId: string, sectionId: string, status: string) =>
        db
          .insertInto('class_teacher_assignments')
          .values({
            id: randomUUID(),
            academic_year_id: yearId,
            section_id: sectionId,
            teacher_id: teacherId,
            status,
            assigned_on: '2026-06-01',
            ended_on: null,
            ...ts,
          })
          .execute();
      await assign(current, a, 'ACTIVE');
      await assign(current, b, 'INACTIVE');
      await assign(closed, b, 'ACTIVE');
      expect(await store.repositories.authScope.classTeacherSections(teacherId)).toEqual([
        { academicYearId: current, sectionId: a },
      ]);

      const studentId = await f.student(await f.user());
      await f.enrolment(studentId, closed, a, 'PROMOTED');
      await f.enrolment(studentId, current, b, 'ACTIVE');
      expect(await store.repositories.authScope.studentSections(studentId)).toEqual([
        { academicYearId: current, sectionId: b },
      ]);
    });
  });

  describe('academic history (enrolments)', () => {
    it('a student has at most one ACTIVE enrolment per academic year', async () => {
      const yearId = await f.year();
      const classId = await f.classRow();
      const studentId = await f.student(await f.user());
      await f.enrolment(studentId, yearId, await f.section(classId, 'A'));
      const sectionB = await f.section(classId, 'B');
      await expect(guard(() => f.enrolment(studentId, yearId, sectionB))).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('promotion/transfer keeps prior years: history rows coexist with the new active row', async () => {
      const year1 = await f.year('CLOSED', '2025-26');
      const year2 = await f.year('CURRENT', '2026-27');
      const studentId = await f.student(await f.user());
      const nine = await f.section(await f.classRow('IX'));
      const ten = await f.section(await f.classRow('X'));
      await f.enrolment(studentId, year1, nine, 'PROMOTED', '7');
      await f.enrolment(studentId, year2, ten, 'ACTIVE', '7');
      // Mid-year transfer within the same year: close the old row, open a new one.
      const tenB = await f.section(
        (
          await db
            .selectFrom('sections')
            .select('class_id')
            .where('id', '=', ten)
            .executeTakeFirstOrThrow()
        ).class_id,
        'B',
      );
      await db
        .updateTable('enrolments')
        .set({ status: 'TRANSFERRED', ended_on: '2026-09-30' })
        .where('student_id', '=', studentId)
        .where('academic_year_id', '=', year2)
        .execute();
      await f.enrolment(studentId, year2, tenB, 'ACTIVE');

      const history = await db
        .selectFrom('enrolments')
        .select(['academic_year_id', 'status'])
        .where('student_id', '=', studentId)
        .execute();
      expect(history).toHaveLength(3);
    });

    it('roll numbers are unique among active students of a section and year', async () => {
      const yearId = await f.year();
      const sectionId = await f.section(await f.classRow());
      await f.enrolment(await f.student(await f.user()), yearId, sectionId, 'ACTIVE', '1');
      await expect(
        guard(async () =>
          f.enrolment(await f.student(await f.user()), yearId, sectionId, 'ACTIVE', '1'),
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      // A former student's roll number does not block reuse.
      await f.enrolment(await f.student(await f.user()), yearId, sectionId, 'LEFT', '2');
      await f.enrolment(await f.student(await f.user()), yearId, sectionId, 'ACTIVE', '2');
    });
  });
});

describe('database error classification', () => {
  it.each([
    ['SQLITE_CONSTRAINT_UNIQUE', 'unique'],
    ['SQLITE_CONSTRAINT_FOREIGNKEY', 'foreign_key'],
    ['SQLITE_CONSTRAINT_TRIGGER', 'foreign_key'],
    ['SQLITE_CONSTRAINT_CHECK', 'integrity'],
    ['23505', 'unique'],
    ['23503', 'foreign_key'],
    ['23001', 'foreign_key'],
    ['23514', 'integrity'],
    ['ECONNREFUSED', 'unavailable'],
    ['XX000', 'unknown'],
  ])('%s → %s', (code, kind) => {
    expect(classifyDbError({ code })).toBe(kind);
  });

  it('passes non-database errors through untouched', async () => {
    const original = new Error('plain');
    await expect(guard(() => Promise.reject(original))).rejects.toBe(original);
  });
});
