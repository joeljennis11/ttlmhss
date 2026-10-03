/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/data/kysely/database-schema.js';
import { peopleModule } from '../src/modules/people/people.module.js';
import { adminSession, call, sessionFor, type Session } from './support/api-helpers.js';
import { seedAccount } from './support/auth-fixtures.js';
import {
  buildTestApp,
  openTestDatabase,
  signIn,
  type TestApp,
  type TestDriver,
} from './support/test-harness.js';

/*
 * Phase 5 — Student & teacher management API. TEST DATA ONLY: every name and number below is
 * synthetic and lives in a throwaway in-memory database.
 */

interface School {
  pastYear: string;
  year: string;
  nextYear: string;
  ix: string;
  x: string;
  ixA: string;
  ixB: string;
  xA: string;
  inactiveSection: string;
  maths: string;
  english: string;
  oldSubject: string;
}

/** Builds a synthetic school through the Phase 4 admin API (the real path an administrator uses). */
async function setupSchool(admin: Session): Promise<School> {
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await call(admin, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  };
  const past = await ok('POST', '/admin/academic-years', {
    label: 'TEST-2025',
    startDate: '2025-06-01',
    endDate: '2026-04-30',
  });
  const year = await ok('POST', '/admin/academic-years', {
    label: 'TEST-2026',
    startDate: '2026-05-15',
    endDate: '2027-04-30',
  });
  const next = await ok('POST', '/admin/academic-years', {
    label: 'TEST-2027',
    startDate: '2027-06-01',
    endDate: '2028-04-30',
  });
  await ok('POST', `/admin/academic-years/${past.id}/make-current`);
  await ok('POST', `/admin/academic-years/${year.id}/make-current`); // past → CLOSED
  const ix = await ok('POST', '/admin/classes', { name: 'TEST-IX', displayOrder: 9 });
  await ok('POST', `/admin/classes/${ix.id}/sections`, { name: 'A' });
  await ok('POST', `/admin/classes/${ix.id}/sections`, { name: 'B' });
  const cls = await ok('POST', `/admin/classes/${ix.id}/sections`, { name: 'Z' });
  const inactiveSection = cls.sections.find((s: any) => s.name === 'Z').id;
  await ok('PATCH', `/admin/sections/${inactiveSection}`, { status: 'INACTIVE' });
  const x = await ok('POST', '/admin/classes', { name: 'TEST-X', displayOrder: 10 });
  const xc = await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
  const maths = await ok('POST', '/admin/subjects', {
    name: 'Test Maths',
    code: 'TMA',
    displayOrder: 1,
  });
  const english = await ok('POST', '/admin/subjects', {
    name: 'Test English',
    code: 'TEN',
    displayOrder: 2,
  });
  const old = await ok('POST', '/admin/subjects', {
    name: 'Test Old',
    code: null,
    displayOrder: 3,
  });
  await ok('PATCH', `/admin/subjects/${old.id}`, { status: 'INACTIVE' });
  return {
    pastYear: past.id,
    year: year.id,
    nextYear: next.id,
    ix: ix.id,
    x: x.id,
    ixA: cls.sections.find((s: any) => s.name === 'A').id,
    ixB: cls.sections.find((s: any) => s.name === 'B').id,
    xA: xc.sections[0].id,
    inactiveSection,
    maths: maths.id,
    english: english.id,
    oldSubject: old.id,
  };
}

const student = (s: School, n: number, extra: Record<string, unknown> = {}) => ({
  admissionNumber: `T/2026/${String(n).padStart(3, '0')}`,
  admissionDate: '2026-06-01',
  fullName: `Test Student ${n}`,
  academicYearId: s.year,
  sectionId: s.ixA,
  rollNumber: String(n),
  ...extra,
});

const teacher = (n: number, extra: Record<string, unknown> = {}) => ({
  staffCode: `TST-${n}`,
  fullName: `Test Teacher ${n}`,
  designation: 'Test Designation',
  ...extra,
});

// ---------------------------------------------------------------------------
// Core flows on both providers
// ---------------------------------------------------------------------------

describe.each<TestDriver>(['sqlite', 'postgres'])('student & teacher management (%s)', (driver) => {
  let h: TestApp;
  let db: Kysely<Database>;
  let admin: Session;
  let s: School;

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    db = opened.db;
    h = await buildTestApp({ dataStore: opened.store });
    admin = await adminSession(h);
    s = await setupSchool(admin);
  }, 60_000);
  afterEach(async () => {
    await h.close();
  });

  it('admission creates the student, a STUDENT account with a temporary password, and the first placement', async () => {
    const res = await call(
      admin,
      'POST',
      '/admin/students',
      student(s, 1, { fatherName: 'Test Father', pincode: '600001' }),
    );
    expect(res.status).toBe(201);
    expect(res.raw).not.toMatch(/temporaryPassword|password_?hash|"password"/i);
    const v = res.data;
    expect(v).toMatchObject({
      admissionNumber: 'T/2026/001',
      fullName: 'Test Student 1',
      status: 'ACTIVE',
      fatherName: 'Test Father',
      current: {
        className: 'TEST-IX',
        sectionName: 'A',
        rollNumber: '1',
        status: 'ACTIVE',
        academicYearId: s.year,
      },
      account: {
        username: 't-2026-001',
        status: 'ACTIVE',
        mustChangePassword: true,
        lastLoginAt: null,
      },
      deletable: true,
    });
    expect(v.history).toHaveLength(1);

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('username', '=', 't-2026-001')
      .executeTakeFirstOrThrow();
    expect(user.role).toBe('STUDENT');
    const cred = await db
      .selectFrom('user_credentials')
      .selectAll()
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(cred.password_status).toBe('TEMPORARY');
    expect(cred.password_hash.startsWith('$argon2id$')).toBe(true);

    const audit = await db.selectFrom('audit_logs').selectAll().execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['account.created', 'student.admitted']),
    );
    expect(JSON.stringify(audit)).not.toMatch(/password_hash|temporaryPassword/);
  });

  it('admission validates identifiers, placement and fields', async () => {
    expect((await call(admin, 'POST', '/admin/students', student(s, 1))).status).toBe(201);
    const dupe = await call(
      admin,
      'POST',
      '/admin/students',
      student(s, 2, { admissionNumber: 't/2026/001' }),
    );
    expect(dupe.status).toBe(409);
    expect(dupe.error.details[0].path).toBe('body.admissionNumber');
    const roll = await call(admin, 'POST', '/admin/students', student(s, 3, { rollNumber: '1' }));
    expect(roll.status).toBe(409);
    expect(roll.error.details[0].path).toBe('body.rollNumber');
    const user = await call(
      admin,
      'POST',
      '/admin/students',
      student(s, 4, { username: 't-2026-001' }),
    );
    expect(user.error.details[0].path).toBe('body.username');
    const inactive = await call(
      admin,
      'POST',
      '/admin/students',
      student(s, 5, { sectionId: s.inactiveSection }),
    );
    expect(inactive.error.details[0].path).toBe('body.sectionId');
    const closed = await call(
      admin,
      'POST',
      '/admin/students',
      student(s, 6, { academicYearId: s.pastYear, admissionDate: '2025-07-01' }),
    );
    expect(closed.status).toBe(409);
    const bad = await call(
      admin,
      'POST',
      '/admin/students',
      student(s, 7, { fullName: ' ', dateOfBirth: '2030-01-01', email: 'x', pincode: '12' }),
    );
    expect(bad.status).toBe(400);
    const paths = bad.error.details.map((d: any) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['body.fullName', 'body.email', 'body.pincode']));
    // Nothing half-created by the failures above.
    expect((await db.selectFrom('students').select('id').execute()).length).toBe(1);
    expect(
      (await db.selectFrom('users').select('id').where('role', '=', 'STUDENT').execute()).length,
    ).toBe(1);
  });

  it('list: search, filters, sorting and pagination happen on the server', async () => {
    for (let n = 1; n <= 7; n++) {
      await call(
        admin,
        'POST',
        '/admin/students',
        student(s, n, { sectionId: n <= 4 ? s.ixA : s.ixB, rollNumber: String(10 - n) }),
      );
    }
    let r = await call(admin, 'GET', '/admin/students?pageSize=5&page=1&sort=name');
    expect(r.data).toMatchObject({ total: 7, page: 1, pageSize: 5, academicYearId: s.year });
    expect(r.data.items).toHaveLength(5);
    r = await call(admin, 'GET', '/admin/students?pageSize=5&page=2&sort=name');
    expect(r.data.items.map((i: any) => i.fullName)).toEqual(['Test Student 6', 'Test Student 7']);
    r = await call(admin, 'GET', `/admin/students?sectionId=${s.ixB}`);
    expect(r.data.total).toBe(3);
    r = await call(admin, 'GET', `/admin/students?classId=${s.ix}&sort=roll`);
    expect(r.data.items[0].placement.rollNumber).toBe('3');
    r = await call(admin, 'GET', '/admin/students?q=student%204');
    expect(r.data.items.map((i: any) => i.admissionNumber)).toEqual(['T/2026/004']);
    r = await call(admin, 'GET', '/admin/students?q=2026/00');
    expect(r.data.total).toBe(7);
    r = await call(admin, 'GET', '/admin/students?q=%25');
    expect(r.data.total).toBe(0); // wildcards are escaped
    r = await call(admin, 'GET', `/admin/students?academicYearId=${s.nextYear}&status=UNPLACED`);
    expect(r.data.total).toBe(7);
    expect((await call(admin, 'GET', '/admin/students?pageSize=500')).status).toBe(400);
  });

  it('edit changes details only; identifiers and placement are untouched and the change is audited', async () => {
    const created = (await call(admin, 'POST', '/admin/students', student(s, 1))).data;
    const res = await call(admin, 'PUT', `/admin/students/${created.id}`, {
      fullName: 'Test Student One',
      phone: '+91 90000 00000',
      city: 'Test City',
      admissionNumber: 'HACK-1',
      sectionId: s.ixB,
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      fullName: 'Test Student One',
      phone: '+91 90000 00000',
      admissionNumber: 'T/2026/001',
    });
    expect(res.data.current.sectionId).toBe(s.ixA);
    const audit = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'student.updated')
      .executeTakeFirstOrThrow();
    expect(JSON.parse(audit.after_json!)).toEqual({
      fullName: 'Test Student One',
      phone: '+91 90000 00000',
      city: 'Test City',
    });
    expect(JSON.parse(audit.before_json!)).toEqual({
      fullName: 'Test Student 1',
      phone: null,
      city: null,
    });
  });

  it('temporary password: shown once, never stored in plain text, forces a change at first sign-in', async () => {
    const created = (await call(admin, 'POST', '/admin/students', student(s, 1))).data;
    const res = await call(admin, 'POST', `/admin/students/${created.id}/temporary-password`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { username, temporaryPassword } = res.data;
    expect(username).toBe('t-2026-001');
    const login = await signIn(h.app, username, temporaryPassword);
    expect(login.response.statusCode).toBe(200);
    expect(JSON.parse(login.response.body).data.user.mustChangePassword).toBe(true);
    const everything = JSON.stringify(await db.selectFrom('audit_logs').selectAll().execute());
    expect(everything).not.toContain(temporaryPassword);
    // The student's own session cannot reach admin APIs.
    const studentSession = { app: h.app, cookie: login.cookie! };
    expect((await call(studentSession, 'GET', '/admin/students')).status).toBe(403);
  });

  it('deactivation blocks sign-in and ends sessions; reactivation restores access; records stay', async () => {
    const created = (await call(admin, 'POST', '/admin/students', student(s, 1))).data;
    const { temporaryPassword } = (
      await call(admin, 'POST', `/admin/students/${created.id}/temporary-password`)
    ).data;
    const first = await signIn(h.app, 't-2026-001', temporaryPassword);
    expect(first.response.statusCode).toBe(200);

    const off = await call(admin, 'POST', `/admin/students/${created.id}/status`, {
      status: 'INACTIVE',
      note: 'Test reason',
    });
    expect(off.data).toMatchObject({ status: 'INACTIVE', account: { status: 'INACTIVE' } });
    expect(off.data.history).toHaveLength(1);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: first.cookie! },
    });
    expect(me.statusCode).toBe(401);
    expect((await signIn(h.app, 't-2026-001', temporaryPassword)).response.statusCode).toBe(401);

    const on = await call(admin, 'POST', `/admin/students/${created.id}/status`, {
      status: 'ACTIVE',
    });
    expect(on.data.account.status).toBe('ACTIVE');
    expect((await signIn(h.app, 't-2026-001', temporaryPassword)).response.statusCode).toBe(200);
  });

  it('transfer closes the old placement and opens a new one (history preserved)', async () => {
    const created = (await call(admin, 'POST', '/admin/students', student(s, 1))).data;
    await call(
      admin,
      'POST',
      '/admin/students',
      student(s, 2, { sectionId: s.ixB, rollNumber: '7' }),
    );
    const same = await call(admin, 'POST', `/admin/students/${created.id}/transfer`, {
      targetSectionId: s.ixA,
      effectiveDate: '2026-08-01',
    });
    expect(same.status).toBe(409);
    const early = await call(admin, 'POST', `/admin/students/${created.id}/transfer`, {
      targetSectionId: s.ixB,
      effectiveDate: '2026-05-20',
    });
    expect(early.error.details[0].path).toBe('body.effectiveDate');
    const clash = await call(admin, 'POST', `/admin/students/${created.id}/transfer`, {
      targetSectionId: s.ixB,
      effectiveDate: '2026-08-01',
      rollNumber: '7',
    });
    expect(clash.error.details[0].path).toBe('body.rollNumber');

    const res = await call(admin, 'POST', `/admin/students/${created.id}/transfer`, {
      targetSectionId: s.ixB,
      effectiveDate: '2026-08-01',
      rollNumber: '8',
      note: 'Test move',
    });
    expect(res.status).toBe(200);
    expect(res.data.current).toMatchObject({
      sectionName: 'B',
      rollNumber: '8',
      startedOn: '2026-08-01',
      status: 'ACTIVE',
    });
    expect(res.data.history).toHaveLength(2);
    const old = res.data.history.find((p: any) => p.sectionName === 'A');
    expect(old).toMatchObject({ status: 'TRANSFERRED', endedOn: '2026-08-01', rollNumber: '1' });
    const rows = await db
      .selectFrom('enrolments')
      .selectAll()
      .where('student_id', '=', created.id)
      .execute();
    expect(rows.every((r) => r.created_by !== null)).toBe(true);
    expect(rows.find((r) => r.status === 'TRANSFERRED')!.closed_by).not.toBeNull();
    // Deletion is now refused: the student has history.
    expect((await call(admin, 'DELETE', `/admin/students/${created.id}`)).status).toBe(409);
  });

  it('promotion: individual outcomes, history preserved, leavers go off roll, no double promotion', async () => {
    const ids: string[] = [];
    for (let n = 1; n <= 4; n++)
      ids.push((await call(admin, 'POST', '/admin/students', student(s, n))).data.id);
    const cand = await call(
      admin,
      'GET',
      `/admin/promotions/candidates?sourceAcademicYearId=${s.year}&sourceSectionId=${s.ixA}&targetAcademicYearId=${s.nextYear}`,
    );
    expect(cand.data.map((c: any) => c.studentId)).toEqual(ids);
    expect(cand.data.every((c: any) => c.targetPlacement === null)).toBe(true);

    const res = await call(admin, 'POST', '/admin/promotions', {
      sourceAcademicYearId: s.year,
      sourceSectionId: s.ixA,
      targetAcademicYearId: s.nextYear,
      decisions: [
        { studentId: ids[0], outcome: 'PROMOTED', targetSectionId: s.xA, rollNumber: '1' },
        { studentId: ids[1], outcome: 'NOT_PROMOTED', targetSectionId: s.ixA },
        { studentId: ids[2], outcome: 'TRANSFERRED' },
        { studentId: ids[3], outcome: 'LEFT' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ promoted: 1, notPromoted: 1, transferred: 1, left: 1 });

    const a = (await call(admin, 'GET', `/admin/students/${ids[0]}`)).data;
    expect(a.history.map((p: any) => [p.academicYearLabel, p.className, p.status])).toEqual([
      ['TEST-2027', 'TEST-X', 'ACTIVE'],
      ['TEST-2026', 'TEST-IX', 'PROMOTED'],
    ]);
    expect(a.history[1].endedOn).toBe('2027-04-30');
    const b = (await call(admin, 'GET', `/admin/students/${ids[1]}`)).data;
    expect(b.history[0]).toMatchObject({ className: 'TEST-IX', academicYearLabel: 'TEST-2027' });
    expect(b.history[1].status).toBe('NOT_PROMOTED');
    for (const [i, reason] of [
      [2, 'TRANSFERRED'],
      [3, 'LEFT'],
    ] as const) {
      const v = (await call(admin, 'GET', `/admin/students/${ids[i]}`)).data;
      expect(v).toMatchObject({
        status: 'INACTIVE',
        exitReason: reason,
        account: { status: 'INACTIVE' },
      });
      expect(v.history).toHaveLength(1);
      expect(v.history[0].status).toBe(reason);
    }
    // Promoting again: the student is no longer in the source class.
    const again = await call(admin, 'POST', '/admin/promotions', {
      sourceAcademicYearId: s.year,
      sourceSectionId: s.ixA,
      targetAcademicYearId: s.nextYear,
      decisions: [{ studentId: ids[0], outcome: 'PROMOTED', targetSectionId: s.xA }],
    });
    expect(again.status).toBe(409);
    // Sanity on target year validation.
    const backwards = await call(admin, 'POST', '/admin/promotions', {
      sourceAcademicYearId: s.year,
      sourceSectionId: s.ixA,
      targetAcademicYearId: s.pastYear,
      decisions: [{ studentId: ids[0], outcome: 'LEFT' }],
    });
    expect(backwards.status).toBe(409);
    const audit = await db
      .selectFrom('audit_logs')
      .select('action')
      .where('action', 'like', 'student%promotion%')
      .execute();
    expect(audit.length).toBe(5); // 4 students + summary
  });

  it('a failing promotion changes nobody (transaction rollback)', async () => {
    const a = (await call(admin, 'POST', '/admin/students', student(s, 1))).data.id;
    const b = (await call(admin, 'POST', '/admin/students', student(s, 2))).data.id;
    // b is already placed in the target year, so its decision fails AFTER a's was applied.
    await call(admin, 'POST', `/admin/students/${b}/placements`, {
      academicYearId: s.nextYear,
      sectionId: s.xA,
      startedOn: '2027-06-01',
    });
    const res = await call(admin, 'POST', '/admin/promotions', {
      sourceAcademicYearId: s.year,
      sourceSectionId: s.ixA,
      targetAcademicYearId: s.nextYear,
      decisions: [
        { studentId: a, outcome: 'PROMOTED', targetSectionId: s.xA },
        { studentId: b, outcome: 'PROMOTED', targetSectionId: s.xA },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.error.details[0].path).toBe('body.decisions.1.studentId');
    const rows = await db
      .selectFrom('enrolments')
      .selectAll()
      .where('student_id', '=', a)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('ACTIVE');
    expect(
      await db
        .selectFrom('audit_logs')
        .select('id')
        .where('action', '=', 'student.promotion')
        .execute(),
    ).toEqual([]);
  });

  it('deleting is limited to unused records created by mistake', async () => {
    const created = (await call(admin, 'POST', '/admin/students', student(s, 1))).data;
    const res = await call(admin, 'DELETE', `/admin/students/${created.id}`);
    expect(res.status).toBe(200);
    expect(
      await db.selectFrom('users').select('id').where('username', '=', 't-2026-001').execute(),
    ).toEqual([]);
    expect(await db.selectFrom('enrolments').select('id').execute()).toEqual([]);
    expect(
      (
        await db
          .selectFrom('audit_logs')
          .select('action')
          .where('action', '=', 'student.deleted')
          .execute()
      ).length,
    ).toBe(1);

    const used = (await call(admin, 'POST', '/admin/students', student(s, 2))).data;
    const { temporaryPassword } = (
      await call(admin, 'POST', `/admin/students/${used.id}/temporary-password`)
    ).data;
    await signIn(h.app, 't-2026-002', temporaryPassword);
    expect((await call(admin, 'GET', `/admin/students/${used.id}`)).data.deletable).toBe(false);
    expect((await call(admin, 'DELETE', `/admin/students/${used.id}`)).status).toBe(409);
  });

  it('teachers: create with a TEACHER account, validation, edit, list filters', async () => {
    const res = await call(
      admin,
      'POST',
      '/admin/teachers',
      teacher(1, { role: 'ADMIN', email: 'test1@test.invalid' }),
    );
    expect(res.status).toBe(201);
    expect(res.raw).not.toMatch(/temporaryPassword|password_?hash|"password"/i);
    expect(res.data).toMatchObject({
      staffCode: 'TST-1',
      status: 'ACTIVE',
      account: { username: 'tst-1', mustChangePassword: true },
    });
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('username', '=', 'tst-1')
      .executeTakeFirstOrThrow();
    expect(user.role).toBe('TEACHER'); // the extra "role" field cannot create an administrator

    expect(
      (await call(admin, 'POST', '/admin/teachers', teacher(2, { staffCode: 'tst-1' }))).error
        .details[0].path,
    ).toBe('body.staffCode');
    expect(
      (await call(admin, 'POST', '/admin/teachers', teacher(3, { username: 'test.admin' }))).error
        .details[0].path,
    ).toBe('body.username');
    expect(
      (await call(admin, 'POST', '/admin/teachers', teacher(4, { phone: 'abc', fullName: '' })))
        .status,
    ).toBe(400);

    const t2 = (
      await call(admin, 'POST', '/admin/teachers', teacher(5, { designation: 'Other Designation' }))
    ).data;
    const edited = await call(admin, 'PUT', `/admin/teachers/${t2.id}`, {
      fullName: 'Test Teacher Five',
      designation: 'Other Designation',
      qualification: 'Test Qual',
      staffCode: 'X',
    });
    expect(edited.data).toMatchObject({
      fullName: 'Test Teacher Five',
      qualification: 'Test Qual',
      staffCode: 'TST-5',
    });

    await call(admin, 'POST', `/admin/teachers/${t2.id}/subjects`, { subjectId: s.maths });
    let list = await call(admin, 'GET', `/admin/teachers?subjectId=${s.maths}`);
    expect(list.data.items.map((t: any) => t.staffCode)).toEqual(['TST-5']);
    list = await call(admin, 'GET', '/admin/teachers?q=five');
    expect(list.data.total).toBe(1);
    list = await call(admin, 'GET', '/admin/teachers?designation=other%20designation');
    expect(list.data.total).toBe(1);
    expect((await call(admin, 'GET', '/admin/teachers/designations')).data).toEqual([
      'Other Designation',
      'Test Designation',
    ]);
  });

  it('Teacher → Subject: valid, duplicate, inactive and unknown subjects; removal', async () => {
    const t = (await call(admin, 'POST', '/admin/teachers', teacher(1))).data;
    let r = await call(admin, 'POST', `/admin/teachers/${t.id}/subjects`, { subjectId: s.maths });
    expect(r.status).toBe(201);
    r = await call(admin, 'POST', `/admin/teachers/${t.id}/subjects`, { subjectId: s.english });
    expect(r.data.subjects.map((x: any) => x.name)).toEqual(['Test Maths', 'Test English']);
    expect(
      (await call(admin, 'POST', `/admin/teachers/${t.id}/subjects`, { subjectId: s.maths }))
        .status,
    ).toBe(409);
    expect(
      (await call(admin, 'POST', `/admin/teachers/${t.id}/subjects`, { subjectId: s.oldSubject }))
        .status,
    ).toBe(409);
    expect(
      (await call(admin, 'POST', `/admin/teachers/${t.id}/subjects`, { subjectId: randomUUID() }))
        .status,
    ).toBe(409);
    // Several teachers may teach the same subject.
    const t2 = (await call(admin, 'POST', '/admin/teachers', teacher(2))).data;
    expect(
      (await call(admin, 'POST', `/admin/teachers/${t2.id}/subjects`, { subjectId: s.maths }))
        .status,
    ).toBe(201);

    r = await call(admin, 'DELETE', `/admin/teachers/${t.id}/subjects/${s.maths}`);
    expect(r.data.subjects.map((x: any) => x.name)).toEqual(['Test English']);
    expect(
      (await call(admin, 'DELETE', `/admin/teachers/${t.id}/subjects/${s.maths}`)).status,
    ).toBe(404);
    const actions = (await db.selectFrom('audit_logs').select('action').execute()).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['teacher.subject_assigned', 'teacher.subject_removed']),
    );
    // The relationship has no class or period columns.
    const cols = Object.keys(
      (await db.selectFrom('teacher_subjects').selectAll().executeTakeFirstOrThrow()) as object,
    );
    expect(cols.sort()).toEqual(['created_at', 'subject_id', 'teacher_id']);
  });

  it('class teacher: assign, prevent duplicates, deliberate reassignment, scope reaches the teacher', async () => {
    const t1 = (await call(admin, 'POST', '/admin/teachers', teacher(1))).data;
    const t2 = (await call(admin, 'POST', '/admin/teachers', teacher(2))).data;
    const assign = (body: object) =>
      call(admin, 'POST', '/admin/class-teachers', {
        academicYearId: s.year,
        sectionId: s.ixA,
        ...body,
      });

    const first = await assign({ teacherId: t1.id });
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({
      teacherName: 'Test Teacher 1',
      className: 'TEST-IX',
      sectionName: 'A',
      academicYearLabel: 'TEST-2026',
      status: 'ACTIVE',
    });
    expect((await assign({ teacherId: t1.id })).status).toBe(409);
    const blocked = await assign({ teacherId: t2.id });
    expect(blocked.status).toBe(409);
    expect(blocked.error.details[0].path).toBe('body.teacherId');
    expect((await assign({ teacherId: t2.id, sectionId: s.inactiveSection })).status).toBe(409);
    expect((await assign({ teacherId: t2.id, academicYearId: s.pastYear })).status).toBe(409);
    expect((await assign({ teacherId: t2.id, academicYearId: randomUUID() })).status).toBe(404);

    // The teacher's next request carries the Class Teacher scope.
    const { temporaryPassword } = (
      await call(admin, 'POST', `/admin/teachers/${t1.id}/temporary-password`)
    ).data;
    const login = await signIn(h.app, 'tst-1', temporaryPassword);
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { cookie: login.cookie! },
      payload: {
        currentPassword: temporaryPassword,
        newPassword: 'Test-teacher-pass-1',
        confirmPassword: 'Test-teacher-pass-1',
      },
    });
    const t1Session = await sessionFor(h, 'tst-1', 'Test-teacher-pass-1');
    let me = (await call(t1Session, 'GET', '/auth/me')).data.user;
    expect(me.roles).toEqual(['TEACHER', 'CLASS_TEACHER']);
    expect(me.classTeacherOf).toEqual([
      expect.objectContaining({ sectionId: s.ixA, academicYearId: s.year }),
    ]);

    // Class teacher scope: their own section's students only, and no management actions.
    await call(admin, 'POST', '/admin/students', student(s, 1));
    const other = (
      await call(admin, 'POST', '/admin/students', student(s, 2, { sectionId: s.ixB }))
    ).data;
    const own = await call(t1Session, 'GET', '/admin/students');
    expect(own.data.items.map((i: any) => i.admissionNumber)).toEqual(['T/2026/001']);
    expect((await call(t1Session, 'GET', `/admin/students/${other.id}`)).status).toBe(403);
    expect((await call(t1Session, 'POST', '/admin/students', student(s, 3))).status).toBe(403);
    expect((await call(t1Session, 'POST', '/admin/promotions', {})).status).toBe(403);

    const re = await assign({ teacherId: t2.id, replace: true });
    expect(re.status).toBe(201);
    const board = (await call(admin, 'GET', `/admin/class-teachers?academicYearId=${s.year}`)).data;
    expect(board.rows.find((r: any) => r.sectionId === s.ixA).assignment.teacherName).toBe(
      'Test Teacher 2',
    );
    expect(board.rows.some((r: any) => r.sectionId === s.inactiveSection)).toBe(false);
    const history = (await call(admin, 'GET', `/admin/teachers/${t1.id}`)).data
      .classTeacherAssignments;
    expect(history[0]).toMatchObject({ status: 'INACTIVE', sectionName: 'A' });
    me = (await call(t1Session, 'GET', '/auth/me')).data.user;
    expect(me.roles).toEqual(['TEACHER']);
    const actions = (await db.selectFrom('audit_logs').select('action').execute()).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['class_teacher.assigned', 'class_teacher.reassigned']),
    );

    const ended = await call(admin, 'POST', `/admin/class-teachers/${re.data.id}/end`);
    expect(ended.data.status).toBe('INACTIVE');
    expect((await call(admin, 'POST', `/admin/class-teachers/${re.data.id}/end`)).status).toBe(409);
  });

  it('deactivating a teacher blocks sign-in and ends their class-teacher role; history is kept', async () => {
    const t = (await call(admin, 'POST', '/admin/teachers', teacher(1))).data;
    await call(admin, 'POST', `/admin/teachers/${t.id}/subjects`, { subjectId: s.maths });
    await call(admin, 'POST', '/admin/class-teachers', {
      academicYearId: s.year,
      sectionId: s.ixA,
      teacherId: t.id,
    });
    const { temporaryPassword } = (
      await call(admin, 'POST', `/admin/teachers/${t.id}/temporary-password`)
    ).data;

    const off = (
      await call(admin, 'POST', `/admin/teachers/${t.id}/status`, { status: 'INACTIVE' })
    ).data;
    expect(off).toMatchObject({ status: 'INACTIVE', account: { status: 'INACTIVE' } });
    expect(off.subjects).toHaveLength(1);
    expect(off.classTeacherAssignments[0].status).toBe('INACTIVE');
    expect((await signIn(h.app, 'tst-1', temporaryPassword)).response.statusCode).toBe(401);
    expect((await call(admin, 'POST', `/admin/teachers/${t.id}/temporary-password`)).status).toBe(
      409,
    );
    expect((await call(admin, 'DELETE', `/admin/teachers/${t.id}`)).status).toBe(409);

    const fresh = (await call(admin, 'POST', '/admin/teachers', teacher(2))).data;
    expect(fresh.deletable).toBe(true);
    expect((await call(admin, 'DELETE', `/admin/teachers/${fresh.id}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('student & teacher management authorization', () => {
  let h: TestApp;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  const routes = (t: TestApp) =>
    peopleModule(t.deps).routes.map((r) => ({
      method: r.method as string,
      url: r.url.replace(/:[A-Za-z]+/g, randomUUID()),
    }));

  it('every route requires sign-in', async () => {
    for (const r of routes(h)) {
      const res = await h.app.inject({
        method: r.method as 'GET',
        url: `/api/v1${r.url}`,
        payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('teachers and students are refused on every management route', async () => {
    await seedAccount(h.deps, { username: 'test.teacher', role: 'TEACHER' });
    await seedAccount(h.deps, { username: 'test.student', role: 'STUDENT' });
    for (const username of ['test.teacher', 'test.student']) {
      const session = await sessionFor(h, username);
      for (const r of routes(h)) {
        const res = await call(
          session,
          r.method,
          r.url,
          r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
        );
        expect(res.status, `${username} ${r.method} ${r.url}`).toBe(403);
        expect(res.error.code).toBe(ErrorCode.FORBIDDEN);
      }
    }
  });

  it('management permissions cannot be granted to non-admin roles', async () => {
    const admin = await adminSession(h);
    for (const permission of [
      'students.create',
      'students.transfer',
      'students.promote',
      'teachers.create',
      'teacher_subjects.manage',
      'class_teacher_assignments.manage',
      'students.delete',
    ]) {
      const res = await call(admin, 'PUT', '/admin/permissions/CLASS_TEACHER', {
        permissions: [permission],
      });
      expect(res.status, permission).toBe(400);
    }
  });
});
