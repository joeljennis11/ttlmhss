import { ErrorCode, PERMISSIONS, type Permission } from '@ttlmhss/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AppDependencies } from '../src/app-dependencies.js';
import { requires, type Principal } from '../src/core/auth/access.js';
import { AuthorizationService } from '../src/core/auth/authorization.service.js';
import { ROLE_PERMISSIONS, permissionsFor } from '../src/core/auth/role-permissions.js';
import { ForbiddenError, UnauthorizedError } from '../src/core/errors/app-errors.js';
import type { FeatureModule } from '../src/core/http/module.js';
import { defineRoute } from '../src/core/http/routes.js';
import {
  PASSWORD,
  assignClassTeacher,
  createSchoolStructure,
  enrol,
  linkStudent,
  linkTeacher,
  seedAccount,
} from './support/auth-fixtures.js';
import { buildTestApp, signIn, type TestApp } from './support/test-harness.js';

/**
 * TEST-ONLY routes shaped like future feature endpoints:
 *   route-level permission (authenticate + authorize) → service-level scope check.
 * They exercise the real access hook, session authenticator and AuthorizationService.
 */
function probeRoutes(deps: AppDependencies): FeatureModule[] {
  const authz = deps.authorization;
  return [
    {
      name: 'authz-probe',
      routes: [
        defineRoute({
          method: 'GET',
          url: '/__test/users',
          access: requires('users.view'),
          handler: () => ({ ok: true }),
        }),
        defineRoute({
          method: 'GET',
          url: '/__test/students/:studentId',
          access: requires('students.view'),
          schema: { params: z.object({ studentId: z.string() }) },
          handler: async ({ params, principal }) => {
            const user = authz.authorize(principal, 'students.view');
            await authz.checkStudentScope(user, params.studentId);
            return { studentId: params.studentId };
          },
        }),
        defineRoute({
          method: 'GET',
          url: '/__test/sections/:sectionId/attendance',
          access: requires('attendance.manage'),
          schema: { params: z.object({ sectionId: z.string() }) },
          handler: ({ params, principal }) => {
            const user = authz.authorize(principal, 'attendance.manage');
            authz.checkSectionScope(user, params.sectionId);
            return { sectionId: params.sectionId };
          },
        }),
        defineRoute({
          method: 'GET',
          url: '/__test/sections/:sectionId/timetable',
          access: requires('timetable.view'),
          schema: { params: z.object({ sectionId: z.string() }) },
          handler: ({ params, principal }) => {
            authz.checkSectionScope(authz.authorize(principal, 'timetable.view'), params.sectionId);
            return { sectionId: params.sectionId };
          },
        }),
        defineRoute({
          method: 'POST',
          url: '/__test/achievements',
          access: requires('achievements.manage'),
          handler: () => ({ ok: true }),
        }),
      ],
    },
  ];
}

describe('authorization (RBAC + scope)', () => {
  let h: TestApp;
  let ids: {
    sectionA: string;
    sectionB: string;
    yearId: string;
    closedYearId: string;
    studentA1: string;
    studentA2: string;
    studentB1: string;
    plainTeacher: string;
    classTeacher: string;
    assignmentId: string;
  };
  const cookies = new Map<string, string>();

  beforeEach(async () => {
    h = await buildTestApp(
      {},
      { modules: probeRoutes, env: { LOGIN_RATE_LIMIT_PER_MINUTE: '1000' } },
    );
    const school = await createSchoolStructure(h.db);

    await seedAccount(h.deps, { username: 'test.admin', role: 'ADMIN' });
    const plainTeacher = await linkTeacher(
      h.db,
      await seedAccount(h.deps, { username: 'test.subject', role: 'TEACHER' }),
      'Subject Teacher',
    );
    const classTeacher = await linkTeacher(
      h.db,
      await seedAccount(h.deps, { username: 'test.classteacher', role: 'TEACHER' }),
      'Class Teacher',
    );
    const assignmentId = await assignClassTeacher(
      h.db,
      classTeacher,
      school.yearId,
      school.sectionA,
    );

    const studentA1 = await linkStudent(
      h.db,
      await seedAccount(h.deps, { username: 'test.a1', role: 'STUDENT' }),
      'Student A1',
    );
    const studentA2 = await linkStudent(
      h.db,
      await seedAccount(h.deps, { username: 'test.a2', role: 'STUDENT' }),
      'Student A2',
    );
    const studentB1 = await linkStudent(
      h.db,
      await seedAccount(h.deps, { username: 'test.b1', role: 'STUDENT' }),
      'Student B1',
    );
    await enrol(h.db, studentA1, school.yearId, school.sectionA);
    await enrol(h.db, studentA2, school.yearId, school.sectionA);
    await enrol(h.db, studentB1, school.yearId, school.sectionB);

    ids = { ...school, studentA1, studentA2, studentB1, plainTeacher, classTeacher, assignmentId };
    cookies.clear();
    for (const username of [
      'test.admin',
      'test.subject',
      'test.classteacher',
      'test.a1',
      'test.b1',
    ]) {
      const { cookie } = await signIn(h.app, username, PASSWORD);
      cookies.set(username, cookie!);
    }
  });
  afterEach(async () => {
    await h.close();
  });

  const call = (as: string | null, url: string, method: 'GET' | 'POST' = 'GET') =>
    h.app.inject({ method, url: `/api/v1${url}`, headers: as ? { cookie: cookies.get(as)! } : {} });
  const status = async (as: string | null, url: string, method: 'GET' | 'POST' = 'GET') =>
    (await call(as, url, method)).statusCode;
  const meOf = async (as: string) => (await call(as, '/auth/me')).json().data.user;

  it('unauthenticated callers are refused everywhere (401)', async () => {
    for (const url of [
      '/__test/users',
      `/__test/students/${ids.studentA1}`,
      `/__test/sections/${ids.sectionA}/attendance`,
    ]) {
      const res = await call(null, url);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe(ErrorCode.UNAUTHORIZED);
    }
    expect(await status(null, '/__test/achievements', 'POST')).toBe(401);
  });

  it('ADMIN: school-wide access', async () => {
    expect(await meOf('test.admin')).toMatchObject({
      roles: ['ADMIN'],
      permissions: [...PERMISSIONS].sort(),
    });
    expect(await status('test.admin', '/__test/users')).toBe(200);
    expect(await status('test.admin', `/__test/students/${ids.studentB1}`)).toBe(200);
    expect(await status('test.admin', `/__test/sections/${ids.sectionB}/attendance`)).toBe(200);
    expect(await status('test.admin', '/__test/achievements', 'POST')).toBe(200);
  });

  it('TEACHER (no class): teacher permissions only, no student/section scope yet', async () => {
    const user = await meOf('test.subject');
    expect(user).toMatchObject({
      accountRole: 'TEACHER',
      roles: ['TEACHER'],
      teacherId: ids.plainTeacher,
      classTeacherOf: [],
    });
    expect(user.permissions).toContain('attendance.mark');
    expect(user.permissions).not.toContain('achievements.manage');

    expect(await status('test.subject', '/__test/users')).toBe(403);
    // Subject teachers cannot manage achievements (BR-ACH-01).
    expect(await status('test.subject', '/__test/achievements', 'POST')).toBe(403);
    // Holds students.view, but teaching scope only arrives with the timetable (Phase 6): denied.
    const res = await call('test.subject', `/__test/students/${ids.studentA1}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ErrorCode.FORBIDDEN);
    expect(await status('test.subject', `/__test/sections/${ids.sectionA}/attendance`)).toBe(403);
  });

  it('CLASS TEACHER: a teacher plus class-level permissions limited to their own section', async () => {
    const user = await meOf('test.classteacher');
    expect(user).toMatchObject({
      accountRole: 'TEACHER',
      roles: ['TEACHER', 'CLASS_TEACHER'],
      classTeacherOf: [{ academicYearId: ids.yearId, sectionId: ids.sectionA }],
    });
    expect(user.permissions).toEqual(
      expect.arrayContaining(['attendance.mark', 'attendance.manage', 'achievements.manage']),
    );

    expect(await status('test.classteacher', `/__test/students/${ids.studentA1}`)).toBe(200);
    expect(await status('test.classteacher', `/__test/students/${ids.studentA2}`)).toBe(200);
    expect(await status('test.classteacher', `/__test/students/${ids.studentB1}`)).toBe(403);
    expect(await status('test.classteacher', `/__test/sections/${ids.sectionA}/attendance`)).toBe(
      200,
    );
    expect(await status('test.classteacher', `/__test/sections/${ids.sectionB}/attendance`)).toBe(
      403,
    );
    expect(await status('test.classteacher', '/__test/achievements', 'POST')).toBe(200);
    expect(await status('test.classteacher', '/__test/users')).toBe(403);
  });

  it('class-teacher scope follows the assignment immediately, without signing in again', async () => {
    const cookie = 'test.classteacher';
    expect(await status(cookie, `/__test/students/${ids.studentA1}`)).toBe(200);

    await h.db
      .updateTable('class_teacher_assignments')
      .set({ status: 'INACTIVE' })
      .where('id', '=', ids.assignmentId)
      .execute();
    expect((await meOf(cookie)).roles).toEqual(['TEACHER']);
    expect(await status(cookie, `/__test/students/${ids.studentA1}`)).toBe(403);
    expect(await status(cookie, '/__test/achievements', 'POST')).toBe(403);

    // An assignment in a non-current academic year grants nothing.
    await assignClassTeacher(h.db, ids.classTeacher, ids.closedYearId, ids.sectionA);
    expect((await meOf(cookie)).roles).toEqual(['TEACHER']);

    await assignClassTeacher(h.db, ids.classTeacher, ids.yearId, ids.sectionB);
    expect(await status(cookie, `/__test/students/${ids.studentB1}`)).toBe(200);
    expect(await status(cookie, `/__test/students/${ids.studentA1}`)).toBe(403);
  });

  it('STUDENT: only their own record — never another student, whatever the URL says', async () => {
    const user = await meOf('test.a1');
    expect(user).toMatchObject({
      accountRole: 'STUDENT',
      roles: ['STUDENT'],
      studentId: ids.studentA1,
      teacherId: null,
    });

    expect(await status('test.a1', `/__test/students/${ids.studentA1}`)).toBe(200);
    expect(await status('test.a1', `/__test/students/${ids.studentA2}`)).toBe(403); // same class
    expect(await status('test.a1', `/__test/students/${ids.studentB1}`)).toBe(403);
    expect(await status('test.b1', `/__test/students/${ids.studentA1}`)).toBe(403);

    // Section-level data (e.g. class timetable) only for the student's own section.
    expect(await status('test.a1', `/__test/sections/${ids.sectionA}/timetable`)).toBe(200);
    expect(await status('test.a1', `/__test/sections/${ids.sectionB}/timetable`)).toBe(403);

    // No management permissions at all.
    expect(await status('test.a1', '/__test/users')).toBe(403);
    expect(await status('test.a1', `/__test/sections/${ids.sectionA}/attendance`)).toBe(403);
    expect(await status('test.a1', '/__test/achievements', 'POST')).toBe(403);
  });
});

describe('role permission map', () => {
  const WRITE_ACTIONS =
    /\.(create|edit|delete|manage|enter|submit|mark|override|generate|handle|promote|reset_password)$/;

  it('ADMIN holds every permission', () => {
    expect([...permissionsFor(['ADMIN'])].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('STUDENT holds no write permission except creating their own requests', () => {
    const writes = [...permissionsFor(['STUDENT'])].filter(
      (p) => WRITE_ACTIONS.test(p) || p === 'requests.create',
    );
    expect(writes).toEqual(['requests.create']);
  });

  it('TEACHER cannot manage accounts, configuration, achievements or override attendance', () => {
    const teacher = permissionsFor(['TEACHER']);
    for (const p of [
      'users.create',
      'config.manage',
      'achievements.manage',
      'attendance.override',
      'marks.edit',
      'audit.view',
    ] as Permission[]) {
      expect(teacher.has(p)).toBe(false);
    }
  });

  it('CLASS_TEACHER adds class-level permissions on top of TEACHER, never admin ones', () => {
    const both = permissionsFor(['TEACHER', 'CLASS_TEACHER']);
    for (const p of ROLE_PERMISSIONS.TEACHER) expect(both.has(p)).toBe(true);
    for (const p of ['achievements.manage', 'attendance.manage', 'marks.edit'] as Permission[])
      expect(both.has(p)).toBe(true);
    for (const p of [
      'users.create',
      'config.manage',
      'attendance.override',
      'audit.view',
    ] as Permission[]) {
      expect(both.has(p)).toBe(false);
    }
  });
});

describe('AuthorizationService guards', () => {
  const authz = new AuthorizationService({
    classTeacherSections: async () => [],
    studentSections: async () => [],
  });
  const base: Principal = {
    userId: 'u',
    username: 'x',
    displayName: 'x',
    accountRole: 'TEACHER',
    roles: ['TEACHER'],
    permissions: permissionsFor(['TEACHER']),
    teacherId: 't',
    studentId: null,
    classTeacherOf: [],
    enrolledIn: [],
    mustChangePassword: false,
    sessionId: 's',
  };

  it('authorize() requires a principal, a changed password and the permission', () => {
    expect(() => authz.authorize(null, 'students.view')).toThrow(UnauthorizedError);
    expect(() => authz.authorize({ ...base, mustChangePassword: true }, 'students.view')).toThrow(
      ForbiddenError,
    );
    expect(() => authz.authorize(base, 'users.create')).toThrow(ForbiddenError);
    expect(authz.authorize(base, 'students.view')).toBe(base);
  });

  it('a STUDENT account is self-scoped even if other data were wrongly attached', async () => {
    const odd: Principal = {
      ...base,
      accountRole: 'STUDENT',
      roles: ['STUDENT'],
      studentId: 's1',
      classTeacherOf: [{ academicYearId: 'y', sectionId: 'sec' }],
    };
    expect(await authz.canAccessStudent(odd, 's1')).toBe(true);
    expect(await authz.canAccessStudent(odd, 's2')).toBe(false);
  });

  it('checkSelfOrAdmin protects per-user resources', () => {
    expect(() => authz.checkSelfOrAdmin(base, 'someone-else')).toThrow(ForbiddenError);
    expect(() => authz.checkSelfOrAdmin(base, 'u')).not.toThrow();
  });
});
