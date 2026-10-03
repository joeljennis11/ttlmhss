/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import {
  CONFIGURABLE_ROLES,
  ErrorCode,
  PERMISSIONS,
  grantableTo,
  type Permission,
} from '@ttlmhss/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '../src/core/auth/role-permissions.js';
import type { Database } from '../src/data/kysely/database-schema.js';
import { configModule } from '../src/modules/config/config.module.js';
import {
  PASSWORD,
  assignClassTeacher,
  createSchoolStructure,
  linkStudent,
  linkTeacher,
  seedAccount,
} from './support/auth-fixtures.js';
import {
  buildTestApp,
  openTestDatabase,
  signIn,
  type TestApp,
  type TestDriver,
} from './support/test-harness.js';

/*
 * Phase 4 — Admin configuration API. TEST DATA ONLY: every name below is synthetic and lives in a
 * throwaway in-memory database.
 */

interface Session {
  app: FastifyInstance;
  cookie: string;
}

async function call(s: Session, method: string, url: string, payload?: unknown) {
  const res = await s.app.inject({
    method: method as 'GET',
    url: `/api/v1${url}`,
    headers: { cookie: s.cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const body = res.body ? (JSON.parse(res.body) as { data?: any; error?: any }) : {};
  return { status: res.statusCode, data: body.data, error: body.error, raw: res.body };
}

async function adminSession(h: TestApp, username = 'test.admin'): Promise<Session> {
  await seedAccount(h.deps, { username, role: 'ADMIN' });
  const { cookie } = await signIn(h.app, username, PASSWORD);
  return { app: h.app, cookie: cookie! };
}

async function auditActions(db: Kysely<Database>) {
  const rows = await db.selectFrom('audit_logs').select(['action']).execute();
  return rows;
}

const YEAR = { label: '2026-27', startDate: '2026-06-01', endDate: '2027-04-30' };

// ---------------------------------------------------------------------------
// Full configuration flow on both providers
// ---------------------------------------------------------------------------

describe.each<TestDriver>(['sqlite', 'postgres'])('admin configuration flow (%s)', (driver) => {
  let h: TestApp;
  let db: Kysely<Database>;
  let admin: Session;

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    db = opened.db;
    h = await buildTestApp({ dataStore: opened.store });
    admin = await adminSession(h);
  });
  afterEach(async () => {
    await h.close();
  });

  it('school settings: saves, validates, audits and feeds public branding', async () => {
    const initial = await call(admin, 'GET', '/admin/school-settings');
    expect(initial.status).toBe(200);
    expect(initial.data.currentAcademicYear).toBeNull();

    const bad = await call(admin, 'PUT', '/admin/school-settings', {
      ...initial.data,
      email: 'not-an-email',
      website: 'example.org',
      logoUrl: 'https://elsewhere.example/logo.png',
    });
    expect(bad.status).toBe(400);
    const paths = (bad.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['body.email', 'body.website', 'body.logoUrl']));

    const saved = await call(admin, 'PUT', '/admin/school-settings', {
      fullName: 'Test School Name',
      shortName: 'TSN',
      motto: '  ',
      address: null,
      phone: null,
      email: 'office@test.invalid',
      website: null,
      principalName: null,
      logoUrl: '/brand/ttlmhss-logo.webp',
    });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      fullName: 'Test School Name',
      motto: null,
      email: 'office@test.invalid',
    });

    const branding = await h.app.inject({ method: 'GET', url: '/api/v1/school/branding' });
    expect(JSON.parse(branding.body).data).toMatchObject({
      fullName: 'Test School Name',
      shortName: 'TSN',
    });

    const audit = await auditActions(db);
    expect(audit.map((a) => a.action)).toContain('config.school_settings.updated');
  });

  it('academic years: overlap, duplicate names, make-current and deletion rules', async () => {
    const a = await call(admin, 'POST', '/admin/academic-years', YEAR);
    expect(a.status).toBe(201);
    expect(a.data.status).toBe('UPCOMING');

    const dupe = await call(admin, 'POST', '/admin/academic-years', {
      ...YEAR,
      label: '2026-27 ',
      startDate: '2027-06-01',
      endDate: '2028-04-30',
    });
    expect(dupe.status).toBe(409);
    const overlap = await call(admin, 'POST', '/admin/academic-years', {
      label: '2027-28',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
    });
    expect(overlap.status).toBe(409);
    const backwards = await call(admin, 'POST', '/admin/academic-years', {
      label: 'X',
      startDate: '2030-06-01',
      endDate: '2030-01-01',
    });
    expect(backwards.status).toBe(400);

    const b = await call(admin, 'POST', '/admin/academic-years', {
      label: '2027-28',
      startDate: '2027-06-01',
      endDate: '2028-04-30',
    });
    expect(b.status).toBe(201);

    expect(
      (await call(admin, 'POST', `/admin/academic-years/${a.data.id}/make-current`)).status,
    ).toBe(200);
    let list = (await call(admin, 'GET', '/admin/academic-years')).data as {
      id: string;
      status: string;
    }[];
    expect(list.find((y) => y.id === a.data.id)!.status).toBe('CURRENT');

    // Moving on: the earlier year closes, exactly one current year remains.
    expect(
      (await call(admin, 'POST', `/admin/academic-years/${b.data.id}/make-current`)).status,
    ).toBe(200);
    list = (await call(admin, 'GET', '/admin/academic-years')).data;
    expect(list.filter((y) => y.status === 'CURRENT').map((y) => y.id)).toEqual([b.data.id]);
    expect(list.find((y) => y.id === a.data.id)!.status).toBe('CLOSED');

    const settings = await call(admin, 'GET', '/admin/school-settings');
    expect(settings.data.currentAcademicYear).toEqual({ id: b.data.id, label: '2027-28' });

    // Current year cannot be deleted; a year with periods (history) cannot be deleted.
    expect((await call(admin, 'DELETE', `/admin/academic-years/${b.data.id}`)).status).toBe(409);
    await call(admin, 'POST', `/admin/academic-years/${a.data.id}/periods`, {
      kind: 'LESSON',
      periodNumber: 1,
      label: 'Period 1',
      startTime: '09:00',
      endTime: '09:45',
    });
    expect((await call(admin, 'DELETE', `/admin/academic-years/${a.data.id}`)).status).toBe(409);

    const c = await call(admin, 'POST', '/admin/academic-years', {
      label: '2028-29',
      startDate: '2028-06-01',
      endDate: '2029-04-30',
    });
    expect((await call(admin, 'DELETE', `/admin/academic-years/${c.data.id}`)).status).toBe(200);

    const wd = await call(admin, 'PUT', `/admin/academic-years/${b.data.id}/working-days`, {
      workingDays: ['SAT', 'MON', 'TUE'],
    });
    expect(wd.status).toBe(200);
    expect(wd.data.workingDays).toEqual(['MON', 'TUE', 'SAT']);
    expect(
      (
        await call(admin, 'PUT', `/admin/academic-years/${b.data.id}/working-days`, {
          workingDays: [],
        })
      ).status,
    ).toBe(400);

    const actions = (await auditActions(db)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'config.academic_year.created',
        'config.academic_year.made_current',
        'config.academic_year.deleted',
      ]),
    );
  });

  it('classes & sections: duplicates are rejected case-insensitively, deactivation keeps rows', async () => {
    const cls = await call(admin, 'POST', '/admin/classes', {
      name: 'Test Class 1',
      displayOrder: 1,
    });
    expect(cls.status).toBe(201);
    expect(
      (await call(admin, 'POST', '/admin/classes', { name: 'test class 1', displayOrder: 2 }))
        .status,
    ).toBe(409);

    const secA = await call(admin, 'POST', `/admin/classes/${cls.data.id}/sections`, { name: 'A' });
    expect(secA.status).toBe(201);
    const dupe = await call(admin, 'POST', `/admin/classes/${cls.data.id}/sections`, { name: 'a' });
    expect(dupe.status).toBe(409);
    expect(dupe.error.details[0].path).toBe('body.name');

    const sectionId = secA.data.sections[0].id as string;
    const off = await call(admin, 'PATCH', `/admin/sections/${sectionId}`, { status: 'INACTIVE' });
    expect(off.status).toBe(200);
    const deact = await call(admin, 'PATCH', `/admin/classes/${cls.data.id}`, {
      status: 'INACTIVE',
    });
    expect(deact.data.status).toBe('INACTIVE');
    const list = (await call(admin, 'GET', '/admin/classes')).data;
    expect(list).toHaveLength(1);
    expect(list[0].sections[0].status).toBe('INACTIVE');

    expect(
      (await call(admin, 'PATCH', `/admin/classes/${randomUUID()}`, { name: 'Nope' })).status,
    ).toBe(404);
  });

  it('subjects: unique name and code, code upper-cased', async () => {
    const s = await call(admin, 'POST', '/admin/subjects', {
      name: 'Test Subject',
      code: 'ts-1',
      displayOrder: 1,
    });
    expect(s.status).toBe(201);
    expect(s.data.code).toBe('TS-1');
    expect(
      (
        await call(admin, 'POST', '/admin/subjects', {
          name: 'TEST SUBJECT',
          code: null,
          displayOrder: 2,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(admin, 'POST', '/admin/subjects', {
          name: 'Other',
          code: 'TS-1',
          displayOrder: 2,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(admin, 'POST', '/admin/subjects', {
          name: 'Bad',
          code: 'no spaces',
          displayOrder: 2,
        })
      ).status,
    ).toBe(400);
  });

  it('periods & breaks: overlaps, duplicate numbers, ordering and copy', async () => {
    const y = (await call(admin, 'POST', '/admin/academic-years', YEAR)).data;
    const add = (body: object) =>
      call(admin, 'POST', `/admin/academic-years/${y.id}/periods`, body);

    expect(
      (
        await add({
          kind: 'LESSON',
          periodNumber: 1,
          label: 'Period 1',
          startTime: '09:00',
          endTime: '09:45',
        })
      ).status,
    ).toBe(201);
    expect(
      (await add({ kind: 'BREAK', label: 'Short break', startTime: '09:45', endTime: '10:00' }))
        .status,
    ).toBe(201);
    const p2 = await add({
      kind: 'LESSON',
      periodNumber: 2,
      label: 'Period 2',
      startTime: '10:00',
      endTime: '10:45',
    });
    expect(p2.status).toBe(201);
    expect(p2.data.slots.map((s: { label: string }) => s.label)).toEqual([
      'Period 1',
      'Short break',
      'Period 2',
    ]);

    const overlap = await add({
      kind: 'LESSON',
      periodNumber: 3,
      label: 'Period 3',
      startTime: '10:30',
      endTime: '11:15',
    });
    expect(overlap.status).toBe(409);
    expect(overlap.error.details[0].path).toBe('body.startTime');
    const sameNumber = await add({
      kind: 'LESSON',
      periodNumber: 2,
      label: 'Again',
      startTime: '11:00',
      endTime: '11:45',
    });
    expect(sameNumber.status).toBe(409);
    const outOfOrder = await add({
      kind: 'LESSON',
      periodNumber: 3,
      label: 'Early',
      startTime: '08:00',
      endTime: '08:45',
    });
    expect(outOfOrder.status).toBe(409);
    expect(
      (
        await add({
          kind: 'BREAK',
          periodNumber: 4,
          label: 'X',
          startTime: '12:00',
          endTime: '12:10',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await add({
          kind: 'LESSON',
          periodNumber: 4,
          label: 'X',
          startTime: '12:00',
          endTime: '11:00',
        })
      ).status,
    ).toBe(400);

    // Copy into an empty year only.
    const next = (
      await call(admin, 'POST', '/admin/academic-years', {
        label: '2027-28',
        startDate: '2027-06-01',
        endDate: '2028-04-30',
      })
    ).data;
    const copied = await call(
      admin,
      'POST',
      `/admin/academic-years/${next.id}/day-structure/copy`,
      { fromAcademicYearId: y.id },
    );
    expect(copied.status).toBe(201);
    expect(copied.data.slots).toHaveLength(3);
    expect(
      (
        await call(admin, 'POST', `/admin/academic-years/${next.id}/day-structure/copy`, {
          fromAcademicYearId: y.id,
        })
      ).status,
    ).toBe(409);

    // Editing and removing keep the order consistent.
    const breakId = p2.data.slots[1].id as string;
    expect(
      (await call(admin, 'PATCH', `/admin/periods/${breakId}`, { startTime: '09:30' })).status,
    ).toBe(409);
    expect((await call(admin, 'DELETE', `/admin/periods/${breakId}`)).status).toBe(200);
  });

  it('attendance cutoff: unconfigured by default, validated and audited', async () => {
    expect((await call(admin, 'GET', '/admin/attendance-policy')).data).toBeNull();
    expect(
      (
        await call(admin, 'PUT', '/admin/attendance-policy', {
          mode: 'MONTHLY_CUTOFF',
          cutoffDay: 31,
        })
      ).status,
    ).toBe(400);
    const saved = await call(admin, 'PUT', '/admin/attendance-policy', {
      mode: 'MONTHLY_CUTOFF',
      cutoffDay: 7,
    });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ mode: 'MONTHLY_CUTOFF', cutoffDay: 7 });
    expect((await auditActions(db)).map((a) => a.action)).toContain(
      'config.attendance_policy.updated',
    );
  });

  it('grade scales: no overlaps or gaps, exact decimals, in-use scales cannot be deleted', async () => {
    const invalid = await call(admin, 'POST', '/admin/grade-scales', {
      name: 'Bad',
      bands: [
        { label: 'A', minPercent: 90, remark: null },
        { label: 'B', minPercent: 90, remark: null },
      ],
    });
    expect(invalid.status).toBe(400);
    const scale = await call(admin, 'POST', '/admin/grade-scales', {
      name: 'Test scale',
      bands: [
        { label: 'C', minPercent: 0, remark: null },
        { label: 'A', minPercent: 80.5, remark: 'Top' },
        { label: 'B', minPercent: 50, remark: null },
      ],
    });
    expect(scale.status).toBe(201);
    expect(scale.data.bands).toEqual([
      { label: 'A', minPercent: 80.5, maxPercent: 100, remark: 'Top' },
      { label: 'B', minPercent: 50, maxPercent: 80.5, remark: null },
      { label: 'C', minPercent: 0, maxPercent: 50, remark: null },
    ]);
    expect(
      (
        await call(admin, 'POST', '/admin/grade-scales', {
          ...scale.data,
          name: 'TEST SCALE',
          bands: scale.data.bands.map(({ maxPercent: _m, ...b }: any) => b),
        })
      ).status,
    ).toBe(409);

    const y = (await call(admin, 'POST', '/admin/academic-years', YEAR)).data;
    await call(admin, 'POST', '/admin/exams', {
      academicYearId: y.id,
      name: 'Exam 1',
      weightagePercent: 10,
      gradeSchemeId: scale.data.id,
      displayOrder: 1,
    });
    const del = await call(admin, 'DELETE', `/admin/grade-scales/${scale.data.id}`);
    expect(del.status).toBe(409);
    expect((await call(admin, 'GET', '/admin/grade-scales')).data[0].inUse).toBe(true);
  });

  it('exams: weightage never exceeds 100%, dates inside the year, subjects per class', async () => {
    const y = (await call(admin, 'POST', '/admin/academic-years', YEAR)).data;
    const cls = (
      await call(admin, 'POST', '/admin/classes', { name: 'Test Class', displayOrder: 1 })
    ).data;
    const sub1 = (
      await call(admin, 'POST', '/admin/subjects', {
        name: 'Subject One',
        code: null,
        displayOrder: 1,
      })
    ).data;
    const sub2 = (
      await call(admin, 'POST', '/admin/subjects', {
        name: 'Subject Two',
        code: null,
        displayOrder: 2,
      })
    ).data;

    const e1 = await call(admin, 'POST', '/admin/exams', {
      academicYearId: y.id,
      name: 'Term 1',
      weightagePercent: 40,
      displayOrder: 1,
    });
    expect(e1.status).toBe(201);
    expect(e1.data.rankScope).toBe('SECTION');
    expect(
      (
        await call(admin, 'POST', '/admin/exams', {
          academicYearId: y.id,
          name: 'term 1',
          weightagePercent: 10,
          displayOrder: 2,
        })
      ).status,
    ).toBe(409);
    const tooMuch = await call(admin, 'POST', '/admin/exams', {
      academicYearId: y.id,
      name: 'Term 2',
      weightagePercent: 60.01,
      displayOrder: 2,
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.error.details[0].path).toBe('body.weightagePercent');
    const outside = await call(admin, 'POST', '/admin/exams', {
      academicYearId: y.id,
      name: 'Term 2',
      weightagePercent: 10,
      startDate: '2025-01-01',
      displayOrder: 2,
    });
    expect(outside.status).toBe(409);
    await call(admin, 'POST', '/admin/exams', {
      academicYearId: y.id,
      name: 'Term 2',
      weightagePercent: 60,
      displayOrder: 2,
      rankScope: 'CLASS',
    });

    const list = await call(admin, 'GET', `/admin/exams?academicYearId=${y.id}`);
    expect(list.data).toMatchObject({ totalWeightagePercent: 100, weightageComplete: true });

    const url = `/admin/exams/${e1.data.id}/classes/${cls.id}/subjects`;
    const badMarks = await call(admin, 'PUT', url, {
      subjects: [{ subjectId: sub1.id, theoryMax: 80, internalMax: 20, passMarks: 101 }],
    });
    expect(badMarks.status).toBe(400);
    const dupes = await call(admin, 'PUT', url, {
      subjects: [
        { subjectId: sub1.id, theoryMax: 100, passMarks: 35 },
        { subjectId: sub1.id, theoryMax: 100, passMarks: 35 },
      ],
    });
    expect(dupes.status).toBe(400);
    const saved = await call(admin, 'PUT', url, {
      subjects: [
        { subjectId: sub1.id, theoryMax: 80, internalMax: 20, passMarks: 35 },
        {
          subjectId: sub2.id,
          theoryMax: 50,
          passMarks: 18,
          normalizedMax: 100,
          includeInResult: false,
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.data.find((s: any) => s.subjectId === sub1.id)).toMatchObject({
      totalMax: 100,
      passMarks: 35,
      includeInResult: true,
    });
    expect(saved.data.find((s: any) => s.subjectId === sub2.id)).toMatchObject({
      totalMax: 50,
      normalizedMax: 100,
      includeInResult: false,
    });

    const one = await call(admin, 'GET', `/admin/exams/${e1.data.id}`);
    expect(one.data).toMatchObject({ name: 'Term 1', weightagePercent: 40, subjectCount: 2 });
    expect((await call(admin, 'GET', `/admin/exams/${randomUUID()}`)).status).toBe(404);

    // An exam with subjects is history-bearing: deactivate, not delete.
    expect((await call(admin, 'DELETE', `/admin/exams/${e1.data.id}`)).status).toBe(409);
    expect(
      (await call(admin, 'PATCH', `/admin/exams/${e1.data.id}`, { status: 'INACTIVE' })).status,
    ).toBe(200);
    const after = await call(admin, 'GET', `/admin/exams?academicYearId=${y.id}`);
    expect(after.data).toMatchObject({ totalWeightagePercent: 60, weightageComplete: false });

    // Inactive subjects cannot be newly added.
    const sub3 = (
      await call(admin, 'POST', '/admin/subjects', {
        name: 'Subject Three',
        code: null,
        displayOrder: 3,
      })
    ).data;
    await call(admin, 'PATCH', `/admin/subjects/${sub3.id}`, { status: 'INACTIVE' });
    const inactive = await call(admin, 'PUT', url, {
      subjects: [{ subjectId: sub3.id, theoryMax: 100, passMarks: 35 }],
    });
    expect(inactive.status).toBe(400);
    expect(inactive.error.details[0]).toMatchObject({ path: 'body.subjects.0.subjectId' });
  });

  it('behaviour categories, five rating labels and achievement categories', async () => {
    const empty = await call(admin, 'GET', '/admin/behaviour');
    expect(empty.data.categories).toEqual([]);
    expect(empty.data.ratingLabels.map((l: any) => l.label)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);

    expect(
      (
        await call(admin, 'POST', '/admin/behaviour/categories', {
          name: 'Test Behaviour',
          description: null,
          displayOrder: 1,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(admin, 'POST', '/admin/behaviour/categories', {
          name: 'test behaviour',
          description: null,
          displayOrder: 2,
        })
      ).status,
    ).toBe(409);

    const four = [1, 2, 3, 4].map((rating) => ({ rating, label: `L${rating}`, description: null }));
    expect(
      (await call(admin, 'PUT', '/admin/behaviour/rating-labels', { labels: four })).status,
    ).toBe(400);
    const five = [...four, { rating: 5, label: 'L5', description: 'Best' }];
    const labels = await call(admin, 'PUT', '/admin/behaviour/rating-labels', { labels: five });
    expect(labels.status).toBe(200);
    expect(labels.data.map((l: any) => l.label)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);

    const ach = await call(admin, 'POST', '/admin/achievement-categories', {
      name: 'Test Achievement',
      description: null,
      displayOrder: 1,
    });
    expect(ach.status).toBe(201);
    expect(
      (
        await call(admin, 'POST', '/admin/achievement-categories', {
          name: 'TEST ACHIEVEMENT',
          description: null,
          displayOrder: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(admin, 'PATCH', `/admin/achievement-categories/${ach.data.id}`, {
          status: 'INACTIVE',
        })
      ).data.status,
    ).toBe('INACTIVE');

    const actions = (await auditActions(db)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'config.behaviour_category.created',
        'config.behaviour_labels.updated',
        'config.achievement_category.created',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe('admin configuration security', () => {
  let h: TestApp;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  const routes = (t: TestApp) =>
    configModule(t.deps).routes.map((r) => ({
      method: r.method as string,
      url: r.url.replace(/:role/g, 'TEACHER').replace(/:[A-Za-z]+/g, randomUUID()),
    }));

  it('every /admin route requires sign-in', async () => {
    const all = routes(h);
    expect(all.length).toBeGreaterThan(30);
    for (const r of all) {
      const res = await h.app.inject({
        method: r.method as 'GET',
        url: `/api/v1${r.url}`,
        payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('teachers, class teachers and students get 403 on every /admin route', async () => {
    const { yearId, sectionA } = await createSchoolStructure(h.db);
    const teacherUser = await seedAccount(h.deps, { username: 'test.teacher', role: 'TEACHER' });
    await linkTeacher(h.db, teacherUser);
    const ctUser = await seedAccount(h.deps, { username: 'test.ct', role: 'TEACHER' });
    await assignClassTeacher(h.db, await linkTeacher(h.db, ctUser), yearId, sectionA);
    const studentUser = await seedAccount(h.deps, { username: 'test.student', role: 'STUDENT' });
    await linkStudent(h.db, studentUser);

    for (const username of ['test.teacher', 'test.ct', 'test.student']) {
      const { cookie } = await signIn(h.app, username, PASSWORD);
      for (const r of routes(h)) {
        const res = await h.app.inject({
          method: r.method as 'GET',
          url: `/api/v1${r.url}`,
          headers: { cookie: cookie! },
          payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
        });
        expect(res.statusCode, `${username} ${r.method} ${r.url}`).toBe(403);
        expect(JSON.parse(res.body).error.code).toBe(ErrorCode.FORBIDDEN);
      }
    }
    expect(
      await h.db.selectFrom('school_settings').select('full_name').executeTakeFirst(),
    ).toBeDefined();
  });

  it('a user who must still change a temporary password cannot use admin routes', async () => {
    await seedAccount(h.deps, { username: 'temp.admin', role: 'ADMIN', temporary: true });
    const { cookie } = await signIn(h.app, 'temp.admin', PASSWORD);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/school-settings',
      headers: { cookie: cookie! },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects malformed ids and unknown fields without leaking internals', async () => {
    const admin = await adminSession(h);
    const res = await call(admin, 'PATCH', '/admin/classes/not-a-uuid', { name: 'X' });
    expect(res.status).toBe(400);
    const sqlish = await call(admin, 'POST', '/admin/classes', {
      name: "x'); DROP TABLE classes;--",
      displayOrder: 1,
    });
    expect(sqlish.status).toBe(201);
    expect((await call(admin, 'GET', '/admin/classes')).data).toHaveLength(1);
    expect(sqlish.raw).not.toMatch(/sqlite|constraint|stack/i);
  });
});

// ---------------------------------------------------------------------------
// Role permissions — no privilege escalation
// ---------------------------------------------------------------------------

describe('role permission configuration', () => {
  let h: TestApp;
  let admin: Session;
  beforeEach(async () => {
    h = await buildTestApp();
    admin = await adminSession(h);
  });
  afterEach(async () => {
    await h.close();
  });

  const me = async (cookie: string) =>
    JSON.parse(
      (await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).body,
    ).data.user.permissions as Permission[];

  it('built-in defaults all sit inside each role ceiling', () => {
    for (const role of CONFIGURABLE_ROLES) {
      const ceiling = new Set(grantableTo(role));
      expect(
        ROLE_PERMISSIONS[role].filter((p) => !ceiling.has(p)),
        role,
      ).toEqual([]);
    }
  });

  it('admin-only permissions are outside every non-admin ceiling', () => {
    const adminOnly: Permission[] = [
      'config.manage',
      'permissions.manage',
      'users.manage',
      'users.view',
    ].filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
    expect(adminOnly).toContain('config.manage');
    for (const role of CONFIGURABLE_ROLES) {
      for (const p of adminOnly) expect(grantableTo(role), `${role} ${p}`).not.toContain(p);
    }
  });

  it('shows admin (fixed) and each role with defaults, effective and ceiling', async () => {
    const view = await call(admin, 'GET', '/admin/permissions');
    expect(view.status).toBe(200);
    expect(view.data.admin).toEqual([...PERMISSIONS]);
    expect(view.data.roles.map((r: any) => r.role)).toEqual([...CONFIGURABLE_ROLES]);
    expect((await call(admin, 'PUT', '/admin/permissions/ADMIN', { permissions: [] })).status).toBe(
      400,
    );
  });

  it('cannot grant anything above the ceiling — nothing is stored on rejection', async () => {
    for (const role of CONFIGURABLE_ROLES) {
      const res = await call(admin, 'PUT', `/admin/permissions/${role}`, {
        permissions: [...ROLE_PERMISSIONS[role], 'config.manage', 'permissions.manage'],
      });
      expect(res.status, role).toBe(400);
    }
    expect(await h.db.selectFrom('role_permission_overrides').selectAll().execute()).toEqual([]);
  });

  it('changes take effect on the next request and are audited; defaults can be restored', async () => {
    await seedAccount(h.deps, { username: 'test.teacher', role: 'TEACHER' });
    const { cookie } = await signIn(h.app, 'test.teacher', PASSWORD);
    expect(await me(cookie!)).toContain('marks.enter');

    const extra = grantableTo('TEACHER').find((p) => !ROLE_PERMISSIONS.TEACHER.includes(p))!;
    expect(extra).toBeDefined();
    const desired = [...ROLE_PERMISSIONS.TEACHER.filter((p) => p !== 'marks.enter'), extra];
    const res = await call(admin, 'PUT', '/admin/permissions/TEACHER', { permissions: desired });
    expect(res.status).toBe(200);
    const teacherView = res.data.roles.find((r: any) => r.role === 'TEACHER');
    expect(teacherView.effective).toContain(extra);
    expect(teacherView.effective).not.toContain('marks.enter');

    const now = await me(cookie!);
    expect(now).not.toContain('marks.enter');
    expect(now).toContain(extra);

    const audit = await h.db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'config.permissions.updated')
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.entity_id).toBe('TEACHER');

    await call(admin, 'PUT', '/admin/permissions/TEACHER', {
      permissions: [...ROLE_PERMISSIONS.TEACHER],
    });
    expect(await h.db.selectFrom('role_permission_overrides').selectAll().execute()).toEqual([]);
    expect(await me(cookie!)).toContain('marks.enter');
  });

  it('a stored override above the ceiling (e.g. edited directly in the database) is ignored at runtime', async () => {
    await h.db
      .insertInto('role_permission_overrides')
      .values({
        role: 'STUDENT',
        permission: 'config.manage',
        effect: 'GRANT',
        updated_by: null,
        updated_at: '2026-06-01T09:00:00.000Z',
      })
      .execute();
    h.deps.rolePermissions.invalidate();
    await seedAccount(h.deps, { username: 'test.student', role: 'STUDENT' });
    const { cookie } = await signIn(h.app, 'test.student', PASSWORD);
    expect(await me(cookie!)).not.toContain('config.manage');
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/school-settings',
      headers: { cookie: cookie! },
    });
    expect(res.statusCode).toBe(403);
  });
});
