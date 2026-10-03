/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import { attendancePercentage, countAttendance } from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, InternalError } from '../src/core/errors/app-errors.js';
import type { DataStore, Repositories } from '../src/data/data-store.js';
import type { Database } from '../src/data/kysely/database-schema.js';
import { adminSession, call, sessionFor, type Session } from './support/api-helpers.js';
import {
  assignClassTeacher,
  linkStudent,
  linkTeacher,
  seedAccount,
} from './support/auth-fixtures.js';
import {
  MutableClock,
  buildTestApp,
  openTestDatabase,
  type TestApp,
  type TestDriver,
} from './support/test-harness.js';

/*
 * Phase 7 — Period-wise attendance. TEST DATA ONLY: every name below is synthetic and lives in a
 * throwaway in-memory database. The school and its timetable are built through the real APIs.
 *
 * Calendar: 2026-06-01 is a Monday. The clock starts on Monday 1 June, 08:30 in the school's time
 * zone, and the timetable is published then.
 */
const MON = '2026-06-01';
const TUE = '2026-06-02';
const NEXT_MON = '2026-06-08';
const DAY_MS = 86_400_000;

interface School {
  year: string;
  pastYear: string;
  p: Record<'P1' | 'P2' | 'P3' | 'BREAK', string>;
  xA: string;
  xB: string;
  maths: string;
  physics: string;
  english: string;
  arun: string;
  priya: string;
  kumar: string;
  /** X-A students by roll number 1..3; s4 in X-B. */
  s1: string;
  s2: string;
  s3: string;
  s4: string;
}

const NOW = '2026-06-01T00:00:00.000Z';

async function setupSchool(h: TestApp, admin: Session, db: Kysely<Database>): Promise<School> {
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await call(admin, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  };
  const past = await ok('POST', '/admin/academic-years', {
    label: 'AT-2025',
    startDate: '2025-06-01',
    endDate: '2026-04-30',
  });
  const year = await ok('POST', '/admin/academic-years', {
    label: 'AT-2026',
    startDate: '2026-05-15',
    endDate: '2027-04-30',
  });
  await ok('POST', `/admin/academic-years/${past.id}/make-current`);
  await ok('POST', `/admin/academic-years/${year.id}/make-current`);
  await ok('PUT', `/admin/academic-years/${year.id}/working-days`, {
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  });
  const slot = (kind: string, label: string, n: number | null, s: string, e: string) =>
    ok('POST', `/admin/academic-years/${year.id}/periods`, {
      kind,
      label,
      periodNumber: n,
      startTime: s,
      endTime: e,
    });
  await slot('LESSON', 'Period 1', 1, '08:00', '08:45');
  await slot('LESSON', 'Period 2', 2, '08:45', '09:30');
  await slot('BREAK', 'Break', null, '09:30', '09:45');
  const day = await slot('LESSON', 'Period 3', 3, '09:45', '10:30');
  const slotId = (label: string) => day.slots.find((x: any) => x.label === label).id;

  const x = await ok('POST', '/admin/classes', { name: 'AT-X', displayOrder: 10 });
  await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
  const xc = await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'B' });
  const sectionId = (name: string) => xc.sections.find((s: any) => s.name === name).id;

  const subject = (name: string, order: number) =>
    ok('POST', '/admin/subjects', { name, code: null, displayOrder: order });
  const maths = await subject('AT Maths', 1);
  const physics = await subject('AT Physics', 2);
  const english = await subject('AT English', 3);

  const teacher = async (username: string, name: string, subjects: string[]) => {
    const id = await linkTeacher(
      db,
      await seedAccount(h.deps, { username, role: 'TEACHER' }),
      name,
    );
    for (const subjectId of subjects)
      await ok('POST', `/admin/teachers/${id}/subjects`, { subjectId });
    return id;
  };
  const arun = await teacher('at.arun', 'AT Arun', [maths.id, physics.id]);
  const priya = await teacher('at.priya', 'AT Priya', [physics.id, english.id]);
  const kumar = await teacher('at.kumar', 'AT Kumar', [english.id]);
  await assignClassTeacher(db, kumar, year.id, sectionId('A'));

  const student = async (username: string, sectionIdValue: string, roll: string) => {
    const id = await linkStudent(
      db,
      await seedAccount(h.deps, { username, role: 'STUDENT' }),
      `AT Student ${roll}${sectionIdValue === sectionId('B') ? 'B' : ''}`,
    );
    await db
      .insertInto('enrolments')
      .values({
        id: randomUUID(),
        student_id: id,
        academic_year_id: year.id,
        section_id: sectionIdValue,
        roll_number: roll,
        status: 'ACTIVE',
        started_on: '2026-05-15',
        ended_on: null,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute();
    return id;
  };
  // Inserted out of order on purpose: the register sorts by roll number.
  const s3 = await student('at.s3', sectionId('A'), '3');
  const s1 = await student('at.s1', sectionId('A'), '1');
  const s2 = await student('at.s2', sectionId('A'), '2');
  const s4 = await student('at.s4', sectionId('B'), '1');

  // Published timetable (version 1), in force from Monday 1 June.
  await ok('POST', `/timetable/years/${year.id}/draft`);
  const lesson = (sectionIdValue: string, d: string, periodId: string, sub: string, t: string) => ({
    op: 'create',
    id: randomUUID(),
    day: d,
    periodId,
    sectionId: sectionIdValue,
    subjectId: sub,
    teacherId: t,
  });
  const p = { P1: slotId('Period 1'), P2: slotId('Period 2'), P3: slotId('Period 3') };
  await ok('POST', `/timetable/years/${year.id}/draft/changes`, {
    sectionId: sectionId('A'),
    operations: [
      lesson(sectionId('A'), 'MON', p.P1, maths.id, arun),
      lesson(sectionId('A'), 'MON', p.P2, physics.id, priya),
      lesson(sectionId('A'), 'MON', p.P3, english.id, kumar),
      lesson(sectionId('B'), 'MON', p.P1, physics.id, priya),
      lesson(sectionId('B'), 'TUE', p.P1, maths.id, arun),
      lesson(sectionId('A'), 'TUE', p.P1, english.id, kumar),
    ],
  });
  await ok('POST', `/timetable/years/${year.id}/draft/publish`);

  return {
    year: year.id,
    pastYear: past.id,
    p: { ...p, BREAK: slotId('Break') },
    xA: sectionId('A'),
    xB: sectionId('B'),
    maths: maths.id,
    physics: physics.id,
    english: english.id,
    arun,
    priya,
    kumar,
    s1,
    s2,
    s3,
    s4,
  };
}

const registerUrl = (date: string, periodId: string, sectionId: string) =>
  `/attendance/register?date=${date}&periodId=${periodId}&sectionId=${sectionId}`;

const save = (
  s: Session,
  date: string,
  periodId: string,
  sectionId: string,
  revision: number | null,
  marks: object[],
  override?: object,
) =>
  call(s, 'PUT', '/attendance/register', {
    date,
    periodId,
    sectionId,
    revision,
    marks,
    ...(override ? { override } : {}),
  });

// ---------------------------------------------------------------------------
// The percentage rule (BR-ATT-03)
// ---------------------------------------------------------------------------

describe('attendance percentage', () => {
  it('counts only P and A; L, C and - are outside the denominator', () => {
    expect(attendancePercentage(2, 1)).toBe(66.67); // P P A
    expect(countAttendance(['P', 'P', 'L']).percentage).toBe(100); // L excluded
    expect(countAttendance(['P', 'C', '-']).percentage).toBe(100); // C and - excluded
    expect(countAttendance(['C', 'L', '-']).percentage).toBeNull(); // nothing measurable
    expect(countAttendance(['P', 'A', 'L', 'C']).percentage).toBe(50);
    expect(countAttendance([]).percentage).toBeNull();
    expect(countAttendance(['P', 'A', 'L', 'C', '-'])).toMatchObject({
      total: 5,
      marked: 4,
      notMarked: 1,
      P: 1,
      A: 1,
      L: 1,
      C: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Core behaviour on both providers
// ---------------------------------------------------------------------------

describe.each<TestDriver>(['sqlite', 'postgres'])('attendance (%s)', (driver) => {
  let h: TestApp;
  let db: Kysely<Database>;
  let clock: MutableClock;
  let admin: Session;
  let s: School;

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    db = opened.db;
    clock = new MutableClock('2026-06-01T03:00:00.000Z'); // Monday 08:30 in India
    h = await buildTestApp({ dataStore: opened.store, clock });
    admin = await adminSession(h);
    s = await setupSchool(h, admin, db);
  }, 120_000);
  afterEach(async () => {
    await h.close();
  });

  it('a teacher opens their own lesson: context and roster come from the timetable and placements', async () => {
    const arun = await sessionFor(h, 'at.arun');
    const lessons = await call(arun, 'GET', `/attendance/lessons?date=${MON}`);
    expect(lessons.status).toBe(200);
    expect(lessons.data).toMatchObject({ schoolDay: true, future: false });
    expect(lessons.data.lessons).toHaveLength(1);
    expect(lessons.data.lessons[0]).toMatchObject({
      period: { id: s.p.P1, label: 'Period 1' },
      section: { sectionId: s.xA, className: 'AT-X', sectionName: 'A' },
      subject: { name: 'AT Maths' },
      attendance: { taken: false, counts: { total: 3, notMarked: 3, percentage: null } },
    });

    const reg = await call(arun, 'GET', registerUrl(MON, s.p.P1, s.xA));
    expect(reg.status).toBe(200);
    expect(reg.data.context).toMatchObject({
      date: MON,
      day: 'MON',
      academicYear: { label: 'AT-2026' },
      period: { label: 'Period 1', startTime: '08:00', endTime: '08:45' },
      section: { className: 'AT-X', sectionName: 'A' },
      subject: { id: s.maths, name: 'AT Maths' },
      teacher: { id: s.arun, fullName: 'AT Arun' },
    });
    expect(reg.data.session).toBeNull();
    expect(reg.data.rows.map((r: any) => [r.rollNumber, r.status])).toEqual([
      ['1', '-'],
      ['2', '-'],
      ['3', '-'],
    ]);
    expect(reg.data.rows.some((r: any) => r.studentId === s.s4)).toBe(false); // another section
    expect(reg.data.access).toMatchObject({
      canMark: true,
      canManage: false,
      locked: false,
      editable: true,
    });
  });

  it('saves period-wise: create, update without duplicates, unmarked stays "-", audited', async () => {
    const arun = await sessionFor(h, 'at.arun');
    const first = await save(arun, MON, s.p.P1, s.xA, null, [
      { studentId: s.s1, status: 'P' },
      { studentId: s.s2, status: 'A' },
      { studentId: s.s3, status: '-' },
    ]);
    expect(first.status).toBe(200);
    expect(first.data.session.revision).toBe(1);
    expect(first.data.rows.map((r: any) => r.status)).toEqual(['P', 'A', '-']);
    expect(first.data.counts).toMatchObject({ P: 1, A: 1, notMarked: 1, percentage: 50 });
    expect(await db.selectFrom('attendance_records').selectAll().execute()).toHaveLength(2);

    // Edit: A → P. One record per student per period, never two.
    const second = await save(arun, MON, s.p.P1, s.xA, 1, [{ studentId: s.s2, status: 'P' }]);
    expect(second.status).toBe(200);
    expect(second.data.session.revision).toBe(2);
    const rows = await db
      .selectFrom('attendance_records')
      .selectAll()
      .where('student_id', '=', s.s2)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'P', academic_year_id: s.year, date: MON });

    // A stale revision is refused (someone else saved meanwhile) — nothing silently overwritten.
    const stale = await save(arun, MON, s.p.P1, s.xA, 1, [{ studentId: s.s1, status: 'A' }]);
    expect(stale.status).toBe(409);
    expect(stale.error.message).toMatch(/saved by at\.arun while you were working/);
    // Saving as if the register were new also conflicts.
    expect(
      (await save(arun, MON, s.p.P1, s.xA, null, [{ studentId: s.s1, status: 'A' }])).status,
    ).toBe(409);

    // Another period is a separate record for the same student.
    const priya = await sessionFor(h, 'at.priya');
    expect(
      (await save(priya, MON, s.p.P2, s.xA, null, [{ studentId: s.s1, status: 'A' }])).status,
    ).toBe(200);
    expect(
      await db
        .selectFrom('attendance_records')
        .selectAll()
        .where('student_id', '=', s.s1)
        .execute(),
    ).toHaveLength(2);

    const audit = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('entity_type', '=', 'attendance_record')
      .execute();
    expect(audit).toHaveLength(4); // s1 -→P, s2 -→A, s2 A→P, s1 -→A (P2)
    const change = audit.find(
      (a) => JSON.parse(a.after_json!).status === 'P' && JSON.parse(a.before_json!).status === 'A',
    )!;
    expect(JSON.parse(change.after_json!)).toMatchObject({
      academicYear: 'AT-2026',
      date: MON,
      period: 'Period 1',
      classSection: 'AT-X A',
      subject: 'AT Maths',
      teacher: 'AT Arun',
      student: 'AT Student 2',
      status: 'P',
      override: false,
    });
    expect(change.actor_user_id).toBeTruthy();
  });

  it('database: one record per (year, date, period, student); statuses and leave reasons are checked', async () => {
    const arun = await sessionFor(h, 'at.arun');
    await save(arun, MON, s.p.P1, s.xA, null, [{ studentId: s.s1, status: 'P' }]);
    const existing = await db
      .selectFrom('attendance_records')
      .selectAll()
      .executeTakeFirstOrThrow();
    const repos = h.deps.dataStore.repositories;
    const base = {
      id: randomUUID(),
      sessionId: existing.session_id,
      academicYearId: existing.academic_year_id,
      date: existing.date,
      periodId: existing.period_id,
      enrolmentId: existing.enrolment_id,
      studentId: existing.student_id,
      leaveReason: null,
      note: null,
    };
    const userId = existing.created_by!;
    await expect(
      repos.attendance.insertRecord({ ...base, status: 'A' }, userId, NOW),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      repos.attendance.updateRecord(
        existing.id,
        { status: 'X' as any, leaveReason: null, note: null },
        userId,
        NOW,
      ),
    ).rejects.toBeInstanceOf(InternalError);
    await expect(
      repos.attendance.updateRecord(
        existing.id,
        { status: 'L', leaveReason: null, note: null },
        userId,
        NOW,
      ),
    ).rejects.toBeInstanceOf(InternalError);
    for (const status of ['-', 'P', 'A', 'C'] as const) {
      await repos.attendance.updateRecord(
        existing.id,
        { status, leaveReason: null, note: null },
        userId,
        NOW,
      );
    }
    await repos.attendance.updateRecord(
      existing.id,
      { status: 'L', leaveReason: 'MEDICAL', note: null },
      userId,
      NOW,
    );
  });

  it('only real lessons have registers: breaks, free periods, non-working days, other years, the future', async () => {
    const reject = async (url: string, pattern: RegExp) => {
      const r = await call(admin, 'GET', url);
      expect(r.status, r.raw).toBe(409);
      expect(r.error.message).toMatch(pattern);
    };
    await reject(registerUrl(MON, s.p.BREAK, s.xA), /is a break/);
    await reject(registerUrl(MON, s.p.P2, s.xB), /no lesson in Period 2 .*free period/);
    await reject(registerUrl('2026-06-06', s.p.P1, s.xA), /not a working day/);
    await reject(registerUrl('2026-05-29', s.p.P1, s.xA), /no published timetable/);
    await reject(registerUrl('2028-01-03', s.p.P1, s.xA), /not within any academic year/);
    await reject(registerUrl(MON, randomUUID(), s.xA), /not part of the AT-2026 school day/);
    // Tuesday's lesson exists but has not happened yet: viewable, not savable.
    const arun = await sessionFor(h, 'at.arun');
    const future = await call(arun, 'GET', registerUrl(TUE, s.p.P1, s.xB));
    expect(future.data.access).toMatchObject({
      editable: false,
      readOnlyReason: 'This lesson has not happened yet.',
    });
    const save1 = await save(arun, TUE, s.p.P1, s.xB, null, [{ studentId: s.s4, status: 'P' }]);
    expect(save1.status).toBe(409);
    expect(save1.error.message).toMatch(/future/);
  });

  it('class teacher: whole class day, Leave/Excused across periods with reasons, scope limited to own class', async () => {
    const kumar = await sessionFor(h, 'at.kumar');
    const arun = await sessionFor(h, 'at.arun');
    await save(arun, MON, s.p.P1, s.xA, null, [
      { studentId: s.s1, status: 'P' },
      { studentId: s.s2, status: 'A' },
    ]);

    const day = await call(kumar, 'GET', `/attendance/class-day?date=${MON}&sectionId=${s.xA}`);
    expect(day.status).toBe(200);
    expect(
      day.data.periods.map((p: any) => [p.period.label, p.subject.name, p.attendance.taken]),
    ).toEqual([
      ['Period 1', 'AT Maths', true],
      ['Period 2', 'AT Physics', false],
      ['Period 3', 'AT English', false],
    ]);
    expect(day.data.periods[0].attendance.counts).toMatchObject({ marked: 2, notMarked: 1 });
    expect(day.data.students[1]).toMatchObject({
      rollNumber: '2',
      statuses: { [s.p.P1]: 'A', [s.p.P2]: '-' },
    });
    expect(
      (await call(kumar, 'GET', `/attendance/class-day?date=${MON}&sectionId=${s.xB}`)).status,
    ).toBe(403);
    // The class teacher may open any period of their class (not just their own lesson).
    const p1 = await call(kumar, 'GET', registerUrl(MON, s.p.P1, s.xA));
    expect(p1.data.access).toMatchObject({ canManage: true, editable: true });

    // Leave across P1–P3: reasons validated.
    const leave = (body: object) =>
      call(kumar, 'PUT', '/attendance/student-day', {
        studentId: s.s3,
        date: MON,
        periodIds: [s.p.P1, s.p.P2, s.p.P3],
        status: 'L',
        ...body,
      });
    expect((await leave({})).status).toBe(400);
    const other = await leave({ leaveReason: 'OTHER' });
    expect(other.status).toBe(400);
    expect(JSON.stringify(other.error.details)).toMatch(/Describe the reason/);
    const ok = await leave({ leaveReason: 'MEDICAL', note: 'Fever' });
    expect(ok.status).toBe(200);
    expect(ok.data.periods.map((p: any) => p.status)).toEqual(['L', 'L', 'L']);
    expect(ok.data.counts).toMatchObject({ L: 3, percentage: null });
    // C (excused) for one period, reason optional.
    const excused = await call(kumar, 'PUT', '/attendance/student-day', {
      studentId: s.s1,
      date: MON,
      periodIds: [s.p.P2],
      status: 'C',
      note: 'Sports practice',
    });
    expect(excused.status).toBe(200);
    // Each affected record is audited individually, marked as a multi-period action.
    const audit = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('entity_type', '=', 'attendance_record')
      .execute();
    const multi = audit.filter((a) => JSON.parse(a.after_json!).multiPeriod === true);
    expect(multi).toHaveLength(4);
    expect(multi.map((a) => a.reason)).toEqual(
      expect.arrayContaining(['MEDICAL: Fever', 'Sports practice']),
    );

    // Subject teachers cannot apply Leave/Excused or overwrite them.
    const p1Again = await call(arun, 'GET', registerUrl(MON, s.p.P1, s.xA));
    const s3row = p1Again.data.rows.find((r: any) => r.studentId === s.s3);
    expect(s3row).toMatchObject({ status: 'L', leaveReason: 'MEDICAL', editable: false });
    const overwrite = await save(arun, MON, s.p.P1, s.xA, p1Again.data.session.revision, [
      { studentId: s.s3, status: 'P' },
    ]);
    expect(overwrite.status).toBe(403);
    expect(overwrite.error.message).toMatch(/marked L by the class teacher/);
    const ownL = await save(arun, MON, s.p.P1, s.xA, p1Again.data.session.revision, [
      { studentId: s.s1, status: 'L', leaveReason: 'PERSONAL' },
    ]);
    expect(ownL.status).toBe(403);
    expect(
      (
        await call(arun, 'PUT', '/attendance/student-day', {
          studentId: s.s1,
          date: MON,
          periodIds: [s.p.P1],
          status: 'C',
        })
      ).status,
    ).toBe(403);
    // Unrelated class.
    expect(
      (
        await call(kumar, 'PUT', '/attendance/student-day', {
          studentId: s.s4,
          date: MON,
          periodIds: [s.p.P1],
          status: 'C',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(kumar, 'GET', `/attendance/student-day?studentId=${s.s4}&date=${MON}`)).status,
    ).toBe(403);
    // A free period cannot get Leave (no lesson, no register).
    const tueFree = await call(kumar, 'PUT', '/attendance/student-day', {
      studentId: s.s1,
      date: MON,
      periodIds: [s.p.BREAK],
      status: 'C',
    });
    expect(tueFree.status).toBe(409);
    expect(tueFree.error.details[0].path).toBe('body.periodIds.0');

    // Summaries use P / (P + A): s2 = A (P1) → 0%; s1 = P, C → 100%; s3 all L → not measurable.
    const summary = await call(
      kumar,
      'GET',
      `/attendance/class-summary?sectionId=${s.xA}&from=${MON}&to=${MON}`,
    );
    expect(summary.status).toBe(200);
    const pct = Object.fromEntries(
      summary.data.students.map((x: any) => [x.rollNumber, x.counts.percentage]),
    );
    expect(pct).toEqual({ '1': 100, '2': 0, '3': null });
    expect(summary.data.students[0].counts).toMatchObject({ P: 1, C: 1, notMarked: 1 });
  });

  it('security: scope comes from the timetable and assignments, never from request ids', async () => {
    const arun = await sessionFor(h, 'at.arun');
    const priya = await sessionFor(h, 'at.priya');
    const student = await sessionFor(h, 'at.s1');

    const anon = await h.app.inject({
      method: 'GET',
      url: `/api/v1${registerUrl(MON, s.p.P1, s.xA)}`,
    });
    expect(anon.statusCode).toBe(401);
    // Another teacher's period in the same class, the same period in another class, another teacher.
    expect((await call(arun, 'GET', registerUrl(MON, s.p.P2, s.xA))).status).toBe(403);
    expect((await call(arun, 'GET', registerUrl(MON, s.p.P1, s.xB))).status).toBe(403);
    expect((await call(priya, 'GET', registerUrl(MON, s.p.P1, s.xA))).status).toBe(403);
    expect(
      (await save(arun, MON, s.p.P1, s.xB, null, [{ studentId: s.s4, status: 'P' }])).status,
    ).toBe(403);
    expect(
      (await save(arun, MON, s.p.P2, s.xA, null, [{ studentId: s.s1, status: 'P' }])).status,
    ).toBe(403);
    // Extra teacher/subject/class ids in the body change nothing: the lesson comes from the timetable.
    const sneaky = await call(arun, 'PUT', '/attendance/register', {
      date: MON,
      periodId: s.p.P1,
      sectionId: s.xA,
      revision: null,
      marks: [{ studentId: s.s1, status: 'P' }],
      teacherId: s.priya,
      subjectId: s.english,
      classId: randomUUID(),
    });
    expect(sneaky.status).toBe(200);
    expect(sneaky.data.context).toMatchObject({
      subject: { id: s.maths },
      teacher: { id: s.arun },
    });
    // A student of another class cannot be marked in this register.
    const wrongStudent = await save(arun, MON, s.p.P1, s.xA, 1, [{ studentId: s.s4, status: 'P' }]);
    expect(wrongStudent.status).toBe(409);
    expect(wrongStudent.error.details[0].path).toBe('body.marks.0.studentId');
    // Lessons of another teacher; class views without being class teacher; admin-only search.
    expect(
      (await call(arun, 'GET', `/attendance/lessons?date=${MON}&teacherId=${s.priya}`)).status,
    ).toBe(403);
    expect(
      (await call(arun, 'GET', `/attendance/class-day?date=${MON}&sectionId=${s.xA}`)).status,
    ).toBe(403);
    expect((await call(arun, 'GET', `/attendance/sessions?academicYearId=${s.year}`)).status).toBe(
      403,
    );
    expect(
      (await call(arun, 'GET', `/attendance/students/${s.s1}?from=${MON}&to=${MON}`)).status,
    ).toBe(403);

    // Students: own attendance only, never changes.
    const own = await call(student, 'GET', `/attendance/me?from=${MON}&to=${MON}`);
    expect(own.status).toBe(200);
    expect(own.data.days[0].cells[s.p.P1]).toEqual({ status: 'P', subjectName: 'AT Maths' });
    expect(
      (await call(student, 'GET', `/attendance/students/${s.s1}?from=${MON}&to=${MON}`)).status,
    ).toBe(200);
    expect(
      (await call(student, 'GET', `/attendance/students/${s.s2}?from=${MON}&to=${MON}`)).status,
    ).toBe(403);
    expect(
      (await call(student, 'GET', `/attendance/students/${randomUUID()}?from=${MON}&to=${MON}`))
        .status,
    ).toBe(403);
    expect((await call(student, 'GET', registerUrl(MON, s.p.P1, s.xA))).status).toBe(403);
    expect(
      (await save(student, MON, s.p.P1, s.xA, 1, [{ studentId: s.s1, status: 'A' }])).status,
    ).toBe(403);
    expect(
      (
        await call(student, 'PUT', '/attendance/student-day', {
          studentId: s.s1,
          date: MON,
          periodIds: [s.p.P1],
          status: 'C',
        })
      ).status,
    ).toBe(403);

    // Administrators: everything.
    expect((await call(admin, 'GET', registerUrl(MON, s.p.P2, s.xA))).data.access).toMatchObject({
      canManage: true,
      editable: true,
    });
    expect(
      (await call(admin, 'GET', `/attendance/class-day?date=${MON}&sectionId=${s.xB}`)).status,
    ).toBe(200);
    const list = await call(
      admin,
      'GET',
      `/attendance/sessions?academicYearId=${s.year}&teacherId=${s.arun}&page=1&pageSize=5`,
    );
    expect(list.data).toMatchObject({ total: 1, page: 1, pageSize: 5 });
    expect(list.data.items[0]).toMatchObject({
      subject: { name: 'AT Maths' },
      counts: { P: 1, notMarked: 2 },
    });
  });

  it('a failed save stores nothing (whole register in one transaction)', async () => {
    const arun = await sessionFor(h, 'at.arun');
    const bad = await save(arun, MON, s.p.P1, s.xA, null, [
      { studentId: s.s1, status: 'P' },
      { studentId: randomUUID(), status: 'A' },
    ]);
    expect(bad.status).toBe(409);
    expect(await db.selectFrom('attendance_records').selectAll().execute()).toHaveLength(0);
    expect(await db.selectFrom('attendance_sessions').selectAll().execute()).toHaveLength(0);
    const invalid = await save(arun, MON, s.p.P1, s.xA, null, [{ studentId: s.s1, status: 'X' }]);
    expect(invalid.status).toBe(400);
  });

  it('cutoff: editable until the configured day, then locked; administrators override with a reason', async () => {
    expect(
      (
        await call(admin, 'PUT', '/admin/attendance-policy', {
          mode: 'MONTHLY_CUTOFF',
          cutoffDay: 7,
        })
      ).status,
    ).toBe(200);
    // 7 July: June is still editable.
    clock.advance(36 * DAY_MS);
    let arun = await sessionFor(h, 'at.arun');
    const before = await save(arun, MON, s.p.P1, s.xA, null, [{ studentId: s.s1, status: 'P' }]);
    expect(before.status).toBe(200);
    // 8 July: June is locked.
    clock.advance(DAY_MS);
    arun = await sessionFor(h, 'at.arun');
    const kumar = await sessionFor(h, 'at.kumar');
    admin = await sessionFor(h, 'test.admin');
    const reg = await call(arun, 'GET', registerUrl(MON, s.p.P1, s.xA));
    expect(reg.data.access).toMatchObject({
      locked: true,
      lockDate: '2026-07-08',
      editable: false,
      canOverride: false,
    });
    expect(
      (await save(arun, MON, s.p.P1, s.xA, 1, [{ studentId: s.s2, status: 'A' }])).status,
    ).toBe(403);
    expect(
      (await save(kumar, MON, s.p.P1, s.xA, 1, [{ studentId: s.s2, status: 'A' }])).status,
    ).toBe(403);
    expect(
      (
        await call(kumar, 'PUT', '/attendance/student-day', {
          studentId: s.s2,
          date: MON,
          periodIds: [s.p.P1],
          status: 'L',
          leaveReason: 'MEDICAL',
        })
      ).status,
    ).toBe(403);

    // Administrator: needs an explicit override with a reason.
    const adminReg = await call(admin, 'GET', registerUrl(MON, s.p.P1, s.xA));
    expect(adminReg.data.access).toMatchObject({ locked: true, canOverride: true, editable: true });
    const noReason = await save(admin, MON, s.p.P1, s.xA, 1, [{ studentId: s.s2, status: 'A' }]);
    expect(noReason.status).toBe(409);
    expect(noReason.error.details[0].path).toBe('body.override');
    const emptyReason = await save(
      admin,
      MON,
      s.p.P1,
      s.xA,
      1,
      [{ studentId: s.s2, status: 'A' }],
      { reason: ' ' },
    );
    expect(emptyReason.status).toBe(400);
    const overridden = await save(admin, MON, s.p.P1, s.xA, 1, [{ studentId: s.s2, status: 'A' }], {
      reason: 'Register corrected after parent meeting',
    });
    expect(overridden.status).toBe(200);
    const entry = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'attendance.override')
      .executeTakeFirstOrThrow();
    expect(entry.reason).toBe('Register corrected after parent meeting');
    expect(JSON.parse(entry.before_json!)).toMatchObject({
      status: '-',
      student: 'AT Student 2',
      date: MON,
      period: 'Period 1',
    });
    expect(JSON.parse(entry.after_json!)).toMatchObject({ status: 'A', override: true });
  });

  it('history: timetable changes never rewrite past attendance; the timetable in force on each date applies', async () => {
    const arun = await sessionFor(h, 'at.arun');
    await save(arun, MON, s.p.P1, s.xA, null, [{ studentId: s.s1, status: 'P' }]);

    // Friday 5 June: P1 Monday for X-A changes to English with Kumar; P3 to Maths with Arun.
    clock.advance(4 * DAY_MS);
    admin = await sessionFor(h, 'test.admin');
    await call(admin, 'POST', `/timetable/years/${s.year}/draft`);
    const ed = await call(admin, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`);
    const entryAt = (periodId: string) =>
      ed.data.entries.find((e: any) => e.day === 'MON' && e.periodId === periodId).id;
    const changes = await call(admin, 'POST', `/timetable/years/${s.year}/draft/changes`, {
      sectionId: s.xA,
      operations: [
        { op: 'update', entryId: entryAt(s.p.P1), subjectId: s.english, teacherId: s.kumar },
        { op: 'remove', entryId: entryAt(s.p.P2) },
        { op: 'update', entryId: entryAt(s.p.P3), subjectId: s.maths, teacherId: s.arun },
      ],
    });
    expect(changes.status).toBe(200);
    expect((await call(admin, 'POST', `/timetable/years/${s.year}/draft/publish`)).status).toBe(
      200,
    );

    // 1 June keeps what happened: the saved register and the lessons in force that day.
    const old = await call(admin, 'GET', registerUrl(MON, s.p.P1, s.xA));
    expect(old.data.context).toMatchObject({
      subject: { name: 'AT Maths' },
      teacher: { fullName: 'AT Arun' },
    });
    expect(old.data.rows[0].status).toBe('P');
    const oldP3 = await call(admin, 'GET', registerUrl(MON, s.p.P3, s.xA));
    expect(oldP3.data.context).toMatchObject({
      subject: { name: 'AT English' },
      teacher: { fullName: 'AT Kumar' },
    });
    const oldP2 = await call(admin, 'GET', registerUrl(MON, s.p.P2, s.xA));
    expect(oldP2.status).toBe(200); // still a lesson on 1 June (removed only from version 2)
    // From 8 June the new timetable applies.
    const next = await call(admin, 'GET', registerUrl(NEXT_MON, s.p.P1, s.xA));
    expect(next.data.context).toMatchObject({
      subject: { name: 'AT English' },
      teacher: { fullName: 'AT Kumar' },
    });
    expect((await call(admin, 'GET', registerUrl(NEXT_MON, s.p.P2, s.xA))).status).toBe(409);
    // Arun still owns his 1 June register …
    const arun2 = await sessionFor(h, 'at.arun');
    expect((await call(arun2, 'GET', registerUrl(MON, s.p.P1, s.xA))).status).toBe(200);
    // …but the new 8 June P1 lesson is no longer his.
    expect((await call(arun2, 'GET', registerUrl(NEXT_MON, s.p.P1, s.xA))).status).toBe(403);
    // The student's view of 1 June still says Maths.
    const view = await call(admin, 'GET', `/attendance/students/${s.s1}?from=${MON}&to=${MON}`);
    expect(view.data.days[0].cells[s.p.P1]).toEqual({ status: 'P', subjectName: 'AT Maths' });
  });
});

// ---------------------------------------------------------------------------
// Placement rules, student view and atomicity (SQLite)
// ---------------------------------------------------------------------------

describe('attendance rosters, student view and atomicity', () => {
  it('the roster follows placement dates; deactivated students are left out', async () => {
    const clock = new MutableClock('2026-06-01T03:00:00.000Z');
    const h = await buildTestApp({ clock });
    try {
      const admin = await adminSession(h);
      const s = await setupSchool(h, admin, h.db);
      // s2 moves from A to B on 1 June (class change: the new class wins that day).
      const e = await h.db
        .selectFrom('enrolments')
        .selectAll()
        .where('student_id', '=', s.s2)
        .executeTakeFirstOrThrow();
      await h.db
        .updateTable('enrolments')
        .set({ status: 'TRANSFERRED', ended_on: MON })
        .where('id', '=', e.id)
        .execute();
      await h.db
        .insertInto('enrolments')
        .values({
          ...e,
          id: randomUUID(),
          section_id: s.xB,
          roll_number: '9',
          started_on: MON,
          status: 'ACTIVE',
        })
        .execute();
      // s3 is deactivated while still placed.
      await h.db
        .updateTable('students')
        .set({ status: 'INACTIVE' })
        .where('id', '=', s.s3)
        .execute();
      const reg = await call(admin, 'GET', registerUrl(MON, s.p.P1, s.xA));
      expect(reg.data.rows.map((r: any) => r.studentId)).toEqual([s.s1]);
      const regB = await call(admin, 'GET', registerUrl(MON, s.p.P1, s.xB));
      expect(regB.data.rows.map((r: any) => r.rollNumber)).toEqual(['1', '9']);
    } finally {
      await h.close();
    }
  }, 60_000);

  it('student view: dates × periods with totals; not-marked lessons show "-" and are excluded from %', async () => {
    const clock = new MutableClock('2026-06-01T03:00:00.000Z');
    const h = await buildTestApp({ clock });
    try {
      const admin = await adminSession(h);
      const s = await setupSchool(h, admin, h.db);
      await save(admin, MON, s.p.P1, s.xA, null, [{ studentId: s.s1, status: 'P' }]);
      await save(admin, MON, s.p.P2, s.xA, null, [{ studentId: s.s1, status: 'A' }]);
      clock.advance(DAY_MS); // Tuesday
      const admin2 = await sessionFor(h, 'test.admin');
      await save(admin2, TUE, s.p.P1, s.xA, null, [{ studentId: s.s1, status: 'P' }]);
      const student = await sessionFor(h, 'at.s1');
      const view = await call(student, 'GET', `/attendance/me?from=${MON}&to=2026-06-05`);
      expect(view.status).toBe(200);
      // Only dates up to today; newest first.
      expect(view.data.days.map((d: any) => d.date)).toEqual([TUE, MON]);
      expect(view.data.periods.map((p: any) => p.label)).toEqual([
        'Period 1',
        'Period 2',
        'Period 3',
      ]);
      expect(view.data.days[1].cells[s.p.P3]).toEqual({ status: '-', subjectName: 'AT English' });
      expect(view.data.counts).toMatchObject({
        total: 4,
        P: 2,
        A: 1,
        notMarked: 1,
        percentage: 66.67,
      });
      // A range longer than 92 days is refused.
      expect(
        (await call(student, 'GET', '/attendance/me?from=2026-06-01&to=2026-12-31')).status,
      ).toBe(400);
    } finally {
      await h.close();
    }
  }, 60_000);

  it('a storage failure part-way through a register rolls the whole save back', async () => {
    const opened = await openTestDatabase('sqlite');
    const state = { failAfter: -1 };
    const wrap = (repos: Repositories): Repositories => ({
      ...repos,
      attendance: new Proxy(repos.attendance, {
        get(target, prop, receiver) {
          if (prop === 'insertRecord') {
            return async (...args: Parameters<typeof target.insertRecord>) => {
              if (state.failAfter === 0) throw new Error('simulated storage failure');
              state.failAfter -= 1;
              return target.insertRecord(...args);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    });
    const store = opened.store;
    const wrapped: DataStore = {
      repositories: store.repositories,
      schema: store.schema,
      ping: () => store.ping(),
      close: () => store.close(),
      transaction: (work) => store.transaction((repos) => work(wrap(repos))),
    };
    const h = await buildTestApp({
      dataStore: wrapped,
      clock: new MutableClock('2026-06-01T03:00:00.000Z'),
    });
    try {
      const admin = await adminSession(h);
      const s = await setupSchool(h, admin, opened.db);
      state.failAfter = 1; // the second student's insert fails
      const res = await save(admin, MON, s.p.P1, s.xA, null, [
        { studentId: s.s1, status: 'P' },
        { studentId: s.s2, status: 'A' },
        { studentId: s.s3, status: 'P' },
      ]);
      expect(res.status).toBe(500);
      expect(res.raw).not.toMatch(/simulated/);
      expect(await opened.db.selectFrom('attendance_records').selectAll().execute()).toHaveLength(
        0,
      );
      expect(await opened.db.selectFrom('attendance_sessions').selectAll().execute()).toHaveLength(
        0,
      );
      expect(
        await opened.db
          .selectFrom('audit_logs')
          .selectAll()
          .where('entity_type', '=', 'attendance_record')
          .execute(),
      ).toHaveLength(0);
    } finally {
      await h.close();
    }
  }, 60_000);
});
