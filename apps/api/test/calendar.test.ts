/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/data/kysely/database-schema.js';
import { CalendarResolver } from '../src/modules/calendar/calendar-resolver.js';
import { adminSession, call, sessionFor, type Session } from './support/api-helpers.js';
import { linkStudent, linkTeacher, seedAccount } from './support/auth-fixtures.js';
import {
  MutableClock,
  buildTestApp,
  openTestDatabase,
  type TestApp,
  type TestDriver,
} from './support/test-harness.js';

/*
 * Phase 8A — Academic calendar. TEST DATA ONLY: synthetic classes in the school's real shape
 * (PreKG, LKG, UKG, 1, 2, 10, 11, 12 by display order) in a throwaway database.
 *
 * June 2026: Mon 1 · Fri 5 · Sat 6 · Sun 7 · Mon 8 · Tue 9 · Wed 10 · Sat 13.
 * The timetable is published on Mon 1 June; attendance is taken "today" = Sat 20 June.
 */
const D = {
  FRI5: '2026-06-05',
  SAT6: '2026-06-06',
  SUN7: '2026-06-07',
  MON8: '2026-06-08',
  TUE9: '2026-06-09',
  WED10: '2026-06-10',
  SAT13: '2026-06-13',
  MON15: '2026-06-15',
};
const DAY_MS = 86_400_000;
const NOW = '2026-06-01T00:00:00.000Z';

interface School {
  year: string;
  pastYear: string;
  cls: Record<string, string>;
  sec: Record<string, string>;
  p1: string;
  p2: string;
  maths: string;
  arun: string;
  priya: string;
  students: Record<string, string>;
}

async function setupSchool(h: TestApp, admin: Session, db: Kysely<Database>): Promise<School> {
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await call(admin, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  };
  const past = await ok('POST', '/admin/academic-years', {
    label: 'CAL-2025',
    startDate: '2025-06-01',
    endDate: '2026-04-30',
  });
  const year = await ok('POST', '/admin/academic-years', {
    label: 'CAL-2026',
    startDate: '2026-05-15',
    endDate: '2027-04-30',
  });
  await ok('POST', `/admin/academic-years/${past.id}/make-current`);
  await ok('POST', `/admin/academic-years/${year.id}/make-current`); // past → CLOSED
  await ok('PUT', `/admin/academic-years/${year.id}/working-days`, {
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  });
  await ok('POST', `/admin/academic-years/${year.id}/periods`, {
    kind: 'LESSON',
    label: 'Period 1',
    periodNumber: 1,
    startTime: '08:00',
    endTime: '08:45',
  });
  const day = await ok('POST', `/admin/academic-years/${year.id}/periods`, {
    kind: 'LESSON',
    label: 'Period 2',
    periodNumber: 2,
    startTime: '08:45',
    endTime: '09:30',
  });
  const cls: Record<string, string> = {};
  const sec: Record<string, string> = {};
  const names = ['PreKG', 'LKG', 'UKG', '1', '2', '10', '11', '12'];
  for (const [i, name] of names.entries()) {
    const c = await ok('POST', '/admin/classes', { name: `CAL ${name}`, displayOrder: i + 1 });
    cls[name] = c.id;
    const withA = await ok('POST', `/admin/classes/${c.id}/sections`, { name: 'A' });
    sec[name] = withA.sections[0].id;
  }
  const tenB = await ok('POST', `/admin/classes/${cls['10']}/sections`, { name: 'B' });
  sec['10B'] = tenB.sections.find((s: any) => s.name === 'B').id;

  const maths = await ok('POST', '/admin/subjects', {
    name: 'CAL Maths',
    code: null,
    displayOrder: 1,
  });
  const teacher = async (username: string, name: string) => {
    const id = await linkTeacher(
      db,
      await seedAccount(h.deps, { username, role: 'TEACHER' }),
      name,
    );
    await ok('POST', `/admin/teachers/${id}/subjects`, { subjectId: maths.id });
    return id;
  };
  const arun = await teacher('cal.arun', 'CAL Arun');
  const priya = await teacher('cal.priya', 'CAL Priya');

  const students: Record<string, string> = {};
  for (const key of ['10', '11', '12']) {
    const id = await linkStudent(
      db,
      await seedAccount(h.deps, { username: `cal.s${key}`, role: 'STUDENT' }),
      `CAL Student ${key}`,
    );
    await db
      .insertInto('enrolments')
      .values({
        id: randomUUID(),
        student_id: id,
        academic_year_id: year.id,
        section_id: sec[key]!,
        roll_number: '1',
        status: 'ACTIVE',
        started_on: '2026-05-15',
        ended_on: null,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute();
    students[key] = id;
  }
  const p1 = day.slots.find((x: any) => x.label === 'Period 1').id;
  const p2 = day.slots.find((x: any) => x.label === 'Period 2').id;
  return {
    year: year.id,
    pastYear: past.id,
    cls,
    sec,
    p1,
    p2,
    maths: maths.id,
    arun,
    priya,
    students,
  };
}

const entryBody = (
  date: string,
  status: 'WORKING' | 'HOLIDAY',
  target:
    | { scope: 'SCHOOL' }
    | { scope: 'CLASSES'; classIds: string[] }
    | { scope: 'SECTIONS'; sectionIds: string[] },
  reason = 'Test reason',
) => ({ date, status, reason, note: null, ...target });

const registerUrl = (date: string, periodId: string, sectionId: string) =>
  `/attendance/register?date=${date}&periodId=${periodId}&sectionId=${sectionId}`;

describe.each<TestDriver>(['sqlite', 'postgres'])('academic calendar (%s)', (driver) => {
  let h: TestApp;
  let db: Kysely<Database>;
  let clock: MutableClock;
  let admin: Session;
  let s: School;

  const add = (body: object) =>
    call(admin, 'POST', `/admin/academic-years/${s.year}/calendar`, body);
  const resolver = async () => {
    const repos = h.deps.dataStore.repositories;
    return CalendarResolver.load(repos, (await repos.academicYears.find(s.year))!);
  };

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    db = opened.db;
    clock = new MutableClock('2026-06-01T03:00:00.000Z'); // Monday 1 June, 08:30 in India
    h = await buildTestApp({ dataStore: opened.store, clock });
    admin = await adminSession(h);
    s = await setupSchool(h, admin, db);
  }, 120_000);
  afterEach(async () => {
    await h.close();
  });

  it('administrators manage entries; each class resolves on its own (A–I)', async () => {
    const empty = await call(admin, 'GET', `/admin/academic-years/${s.year}/calendar`);
    expect(empty.status).toBe(200);
    expect(empty.data.entries).toEqual([]);
    expect(empty.data.academicYear.workingDays).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI']);
    // Classes come in the configured order (not by name).
    expect(empty.data.classes.map((c: any) => c.name)).toEqual(
      ['PreKG', 'LKG', 'UKG', '1', '2', '10', '11', '12'].map((n) => `CAL ${n}`),
    );

    expect(
      (await add(entryBody(D.FRI5, 'HOLIDAY', { scope: 'SCHOOL' }, 'Founders day'))).status,
    ).toBe(201);
    const sat = await add(
      entryBody(
        D.SAT6,
        'WORKING',
        { scope: 'CLASSES', classIds: [s.cls['11']!, s.cls['12']!] },
        'Special class',
      ),
    );
    expect(sat.status).toBe(201);
    await add(
      entryBody(D.SUN7, 'WORKING', { scope: 'CLASSES', classIds: [s.cls['12']!] }, 'Revision'),
    );
    const lower = ['PreKG', 'LKG', 'UKG', '1', '2', '10'].map((n) => s.cls[n]!);
    await add(entryBody(D.MON8, 'HOLIDAY', { scope: 'CLASSES', classIds: lower }, 'Sports day'));
    const tenA = await add(
      entryBody(D.TUE9, 'HOLIDAY', { scope: 'SECTIONS', sectionIds: [s.sec['10']!] }, 'Class trip'),
    );
    expect(tenA.data.entries.map((e: any) => [e.date, e.status, e.appliesTo])).toEqual([
      [D.FRI5, 'HOLIDAY', 'Entire school'],
      [D.SAT6, 'WORKING', 'Classes CAL 11, CAL 12'],
      [D.SUN7, 'WORKING', 'Class CAL 12'],
      [D.MON8, 'HOLIDAY', 'Classes CAL PreKG, CAL LKG, CAL UKG, CAL 1, CAL 2, CAL 10'],
      [D.TUE9, 'HOLIDAY', 'Section CAL 10 A'],
    ]);
    expect(tenA.data.entries[0]).toMatchObject({
      day: 'FRI',
      weeklyWorking: true,
      createdBy: 'test.admin',
    });

    const r = await resolver();
    // A. weekly default
    expect(r.isWorking(D.WED10, s.sec['10']!)).toBe(true);
    expect(r.isWorking(D.SAT13, s.sec['12']!)).toBe(false);
    // B. whole-school holiday
    for (const key of ['PreKG', '10', '11', '12'])
      expect(r.isWorking(D.FRI5, s.sec[key]!)).toBe(false);
    // C / I. class holiday: 10 off, 11 and 12 working
    expect(r.isWorking(D.MON8, s.sec['10']!)).toBe(false);
    expect(r.isWorking(D.MON8, s.sec['PreKG']!)).toBe(false);
    expect(r.isWorking(D.MON8, s.sec['11']!)).toBe(true);
    // D. special working Saturday for 11–12
    expect(r.isWorking(D.SAT6, s.sec['11']!)).toBe(true);
    expect(r.isWorking(D.SAT6, s.sec['10']!)).toBe(false);
    // E. Sunday for 12 only
    expect(r.isWorking(D.SUN7, s.sec['12']!)).toBe(true);
    expect(r.isWorking(D.SUN7, s.sec['11']!)).toBe(false);
    // Section-only holiday
    expect(r.isWorking(D.TUE9, s.sec['10']!)).toBe(false);
    expect(r.isWorking(D.TUE9, s.sec['10B']!)).toBe(true);
    // Timetable days per section: weekly + weekdays of special working dates that apply
    expect(r.lessonDays(s.sec['11']!)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
    expect(r.lessonDays(s.sec['12']!)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    expect(r.lessonDays(s.sec['10']!)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI']);
  });

  it('M. validation keeps the calendar unambiguous', async () => {
    await add(entryBody(D.FRI5, 'HOLIDAY', { scope: 'SCHOOL' }));
    await add(entryBody(D.MON8, 'HOLIDAY', { scope: 'CLASSES', classIds: [s.cls['10']!] }));
    const refuse = async (body: object, pattern: RegExp, status = 409) => {
      const res = await add(body);
      expect(res.status, JSON.stringify(res.error)).toBe(status);
      expect(res.error.message).toMatch(pattern);
      return res;
    };
    // Overlaps: anything on a whole-school date; a class twice; a section of a class with an entry.
    await refuse(
      entryBody(D.FRI5, 'HOLIDAY', { scope: 'CLASSES', classIds: [s.cls['11']!] }),
      /already has "Holiday — Entire school"/,
    );
    await refuse(
      entryBody(D.MON8, 'HOLIDAY', { scope: 'CLASSES', classIds: [s.cls['10']!, s.cls['11']!] }),
      /covers some of the same classes/,
    );
    const sectionClash = await refuse(
      entryBody(D.MON8, 'HOLIDAY', { scope: 'SECTIONS', sectionIds: [s.sec['10B']!] }),
      /Class CAL 10/,
    );
    expect(sectionClash.error.details[0].path).toBe('body.scope');
    // A different class on the same date is fine.
    expect(
      (await add(entryBody(D.MON8, 'HOLIDAY', { scope: 'CLASSES', classIds: [s.cls['12']!] })))
        .status,
    ).toBe(201);
    // Entries must change something.
    await refuse(entryBody(D.WED10, 'WORKING', { scope: 'SCHOOL' }), /already a working day/);
    await refuse(entryBody(D.SAT13, 'HOLIDAY', { scope: 'SCHOOL' }), /already a non-working day/);
    // Dates and targets must be real.
    await refuse(
      entryBody('2027-06-01', 'HOLIDAY', { scope: 'SCHOOL' }),
      /must fall within CAL-2026/,
    );
    await refuse(
      entryBody(D.WED10, 'HOLIDAY', { scope: 'CLASSES', classIds: [randomUUID()] }),
      /classes was not found/,
    );
    await refuse(entryBody(D.WED10, 'HOLIDAY', { scope: 'CLASSES', classIds: [] }), /.+/, 400);
    await refuse(entryBody(D.WED10, 'MAYBE' as any, { scope: 'SCHOOL' }), /.+/, 400);
    // A closed year's calendar is history.
    const closed = await call(admin, 'POST', `/admin/academic-years/${s.pastYear}/calendar`, {
      ...entryBody('2025-12-25', 'HOLIDAY', { scope: 'SCHOOL' }),
    });
    expect(closed.status).toBe(409);
    expect(closed.error.message).toMatch(/closed/);
  });

  it('edit and delete are audited (L) and only administrators may change the calendar (K)', async () => {
    const created = await add(entryBody(D.FRI5, 'HOLIDAY', { scope: 'SCHOOL' }, 'Founders day'));
    const id = created.data.entries[0].id;
    const edited = await call(admin, 'PUT', `/admin/calendar-entries/${id}`, {
      ...entryBody(
        D.FRI5,
        'HOLIDAY',
        { scope: 'CLASSES', classIds: [s.cls['10']!] },
        'Founders day (10)',
      ),
      note: 'Only class 10',
    });
    expect(edited.status).toBe(200);
    expect(edited.data.entries[0]).toMatchObject({
      appliesTo: 'Class CAL 10',
      reason: 'Founders day (10)',
      note: 'Only class 10',
    });
    expect((await call(admin, 'DELETE', `/admin/calendar-entries/${id}`)).status).toBe(200);
    expect((await call(admin, 'DELETE', `/admin/calendar-entries/${id}`)).status).toBe(404);

    const audit = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('entity_type', '=', 'calendar_entry')
      .orderBy('occurred_at')
      .execute();
    expect(audit.map((a) => a.action)).toEqual([
      'calendar.entry_created',
      'calendar.entry_updated',
      'calendar.entry_deleted',
    ]);
    expect(JSON.parse(audit[1]!.before_json!)).toMatchObject({
      academicYear: 'CAL-2026',
      date: D.FRI5,
      status: 'HOLIDAY',
      appliesTo: 'Entire school',
      reason: 'Founders day',
    });
    expect(JSON.parse(audit[1]!.after_json!)).toMatchObject({
      appliesTo: 'Class CAL 10',
      note: 'Only class 10',
    });
    expect(JSON.parse(audit[2]!.before_json!)).toMatchObject({ appliesTo: 'Class CAL 10' });
    expect(audit.every((a) => a.actor_user_id)).toBe(true);

    // K. authorization: only administrators (config.manage); teachers and students are refused.
    const again = await add(entryBody(D.FRI5, 'HOLIDAY', { scope: 'SCHOOL' }));
    const entryId = again.data.entries[0].id;
    for (const username of ['cal.arun', 'cal.s10']) {
      const u = await sessionFor(h, username);
      expect((await call(u, 'GET', `/admin/academic-years/${s.year}/calendar`)).status).toBe(403);
      expect(
        (
          await call(
            u,
            'POST',
            `/admin/academic-years/${s.year}/calendar`,
            entryBody(D.TUE9, 'HOLIDAY', { scope: 'SCHOOL' }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            u,
            'PUT',
            `/admin/calendar-entries/${entryId}`,
            entryBody(D.FRI5, 'HOLIDAY', { scope: 'SCHOOL' }),
          )
        ).status,
      ).toBe(403);
      expect((await call(u, 'DELETE', `/admin/calendar-entries/${entryId}`)).status).toBe(403);
    }
    const anon = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/academic-years/${s.year}/calendar`,
    });
    expect(anon.statusCode).toBe(401);
  });

  it('H. attendance follows the calendar; the timetable stays the lesson source', async () => {
    // A Saturday lesson for 11 A is refused until the calendar has a working Saturday for class 11.
    await call(admin, 'POST', `/timetable/years/${s.year}/draft`);
    const lesson = (sectionId: string, day: string, periodId: string, teacherId: string) => ({
      op: 'create',
      id: randomUUID(),
      day,
      periodId,
      sectionId,
      subjectId: s.maths,
      teacherId,
    });
    const change = (sectionId: string, ops: object[]) =>
      call(admin, 'POST', `/timetable/years/${s.year}/draft/changes`, {
        sectionId,
        operations: ops,
      });
    const early = await change(s.sec['11']!, [lesson(s.sec['11']!, 'SAT', s.p1, s.arun)]);
    expect(early.status).toBe(409);
    expect(early.error.message).toMatch(/Saturday is not a working day for this class/);

    await add(
      entryBody(
        D.SAT6,
        'WORKING',
        { scope: 'CLASSES', classIds: [s.cls['11']!, s.cls['12']!] },
        'Special class',
      ),
    );
    await add(entryBody(D.FRI5, 'HOLIDAY', { scope: 'SCHOOL' }, 'Founders day'));
    await add(
      entryBody(D.MON8, 'HOLIDAY', { scope: 'CLASSES', classIds: [s.cls['10']!] }, 'Sports day'),
    );
    // Class 10 still has no Saturday; 11 now has.
    expect((await change(s.sec['10']!, [lesson(s.sec['10']!, 'SAT', s.p1, s.arun)])).status).toBe(
      409,
    );
    expect(
      (
        await change(s.sec['11']!, [
          lesson(s.sec['11']!, 'SAT', s.p1, s.arun),
          lesson(s.sec['11']!, 'MON', s.p1, s.priya),
          lesson(s.sec['11']!, 'FRI', s.p1, s.priya),
          lesson(s.sec['10']!, 'MON', s.p2, s.arun),
          lesson(s.sec['10']!, 'WED', s.p1, s.arun),
        ])
      ).status,
    ).toBe(200);
    expect((await call(admin, 'POST', `/timetable/years/${s.year}/draft/publish`)).status).toBe(
      200,
    );
    // The class timetable of 11 A shows its Saturday; 10 A's does not.
    const c11 = await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.sec['11']}`);
    expect(c11.data.workingDays).toContain('SAT');
    const c10 = await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.sec['10']}`);
    expect(c10.data.workingDays).not.toContain('SAT');

    clock.advance(19 * DAY_MS); // Saturday 20 June
    admin = await sessionFor(h, 'test.admin');
    const arun = await sessionFor(h, 'cal.arun');

    // Special working Saturday: 11 A's lesson has a register; the next Saturday does not.
    const sat = await call(arun, 'GET', registerUrl(D.SAT6, s.p1, s.sec['11']!));
    expect(sat.status).toBe(200);
    expect(sat.data.context).toMatchObject({ day: 'SAT', section: { sectionId: s.sec['11'] } });
    const satNext = await call(arun, 'GET', registerUrl(D.SAT13, s.p1, s.sec['11']!));
    expect(satNext.status).toBe(409);
    expect(satNext.error.message).toMatch(/not a working day/);
    // Class 10 holiday on Monday 8: refused for 10 A; 11 A works normally.
    const mon10 = await call(admin, 'GET', registerUrl(D.MON8, s.p2, s.sec['10']!));
    expect(mon10.status).toBe(409);
    expect(mon10.error.message).toMatch(/holiday for CAL 10 A \(Sports day\)/);
    expect((await call(admin, 'GET', registerUrl(D.MON8, s.p1, s.sec['11']!))).status).toBe(200);
    // Whole-school holiday: nobody, not even an administrator, creates a register.
    const fri = await call(admin, 'PUT', '/attendance/register', {
      date: D.FRI5,
      periodId: s.p1,
      sectionId: s.sec['11'],
      revision: null,
      marks: [{ studentId: s.students['11'], status: 'P' }],
    });
    expect(fri.status).toBe(409);
    expect(await db.selectFrom('attendance_sessions').selectAll().execute()).toHaveLength(0);

    // Teacher's lessons follow the calendar too.
    const satLessons = await call(arun, 'GET', `/attendance/lessons?date=${D.SAT6}`);
    expect(satLessons.data.schoolDay).toBe(true);
    expect(satLessons.data.lessons.map((l: any) => l.section.sectionId)).toEqual([s.sec['11']]);
    const monLessons = await call(arun, 'GET', `/attendance/lessons?date=${D.MON8}`);
    expect(monLessons.data.lessons).toEqual([]); // his Monday lesson is in class 10 (holiday)
    const tt = await call(arun, 'GET', `/timetable/lessons?date=${D.SAT6}`);
    expect(tt.data.lessons.map((l: any) => l.entry.sectionId)).toEqual([s.sec['11']]);
    const friLessons = await call(arun, 'GET', `/attendance/lessons?date=${D.FRI5}`);
    expect(friLessons.data).toMatchObject({ schoolDay: false, lessons: [] });

    // Saturday attendance saves normally.
    const saved = await call(arun, 'PUT', '/attendance/register', {
      date: D.SAT6,
      periodId: s.p1,
      sectionId: s.sec['11'],
      revision: null,
      marks: [{ studentId: s.students['11'], status: 'P' }],
    });
    expect(saved.status).toBe(200);

    // 13. Holidays add nothing to totals: 11 A's student has P on Sat 6, a Friday holiday on 5 June
    // (no lesson counted) and an unmarked Monday lesson on 8 June.
    const student = await sessionFor(h, 'cal.s11');
    const own = await call(student, 'GET', `/attendance/me?from=${D.FRI5}&to=${D.MON8}`);
    expect(own.data.days.map((d: any) => d.date)).toEqual([D.MON8, D.SAT6]);
    expect(own.data.counts).toMatchObject({ P: 1, A: 0, notMarked: 1, percentage: 100 });
    const summary = await call(
      admin,
      'GET',
      `/attendance/class-summary?sectionId=${s.sec['10']}&from=${D.FRI5}&to=${D.WED10}`,
    );
    // 10 A: Fri holiday, Mon class holiday → only Wednesday's lesson is expected.
    expect(summary.data.counts).toMatchObject({ total: 1, notMarked: 1, percentage: null });
  });

  it('J. a later holiday never deletes attendance; the register stays as read-only history', async () => {
    await call(admin, 'POST', `/timetable/years/${s.year}/draft`);
    await call(admin, 'POST', `/timetable/years/${s.year}/draft/changes`, {
      sectionId: s.sec['10'],
      operations: [
        {
          op: 'create',
          id: randomUUID(),
          day: 'WED',
          periodId: s.p1,
          sectionId: s.sec['10'],
          subjectId: s.maths,
          teacherId: s.arun,
        },
      ],
    });
    await call(admin, 'POST', `/timetable/years/${s.year}/draft/publish`);
    clock.advance(19 * DAY_MS);
    admin = await sessionFor(h, 'test.admin');
    const arun = await sessionFor(h, 'cal.arun');
    const taken = await call(arun, 'PUT', '/attendance/register', {
      date: D.WED10,
      periodId: s.p1,
      sectionId: s.sec['10'],
      revision: null,
      marks: [{ studentId: s.students['10'], status: 'A' }],
    });
    expect(taken.status).toBe(200);

    // The administrator later declares Wednesday 10 June a holiday.
    expect((await add(entryBody(D.WED10, 'HOLIDAY', { scope: 'SCHOOL' }, 'Rain'))).status).toBe(
      201,
    );
    expect(await db.selectFrom('attendance_records').selectAll().execute()).toHaveLength(1);
    const history = await call(admin, 'GET', registerUrl(D.WED10, s.p1, s.sec['10']!));
    expect(history.status).toBe(200);
    expect(history.data.rows[0].status).toBe('A');
    expect(history.data.access).toMatchObject({ editable: false, canOverride: false });
    expect(history.data.access.readOnlyReason).toMatch(/holiday .*kept as history/);
    const change = await call(admin, 'PUT', '/attendance/register', {
      date: D.WED10,
      periodId: s.p1,
      sectionId: s.sec['10'],
      revision: history.data.session.revision,
      marks: [{ studentId: s.students['10'], status: 'P' }],
      override: { reason: 'try' },
    });
    expect(change.status).toBe(409);
    // The saved record still counts as recorded attendance in the student's totals.
    const student = await sessionFor(h, 'cal.s10');
    const own = await call(student, 'GET', `/attendance/me?from=${D.WED10}&to=${D.WED10}`);
    expect(own.data.counts).toMatchObject({ A: 1, percentage: 0 });
    // Removing the holiday again makes the register editable — nothing was lost.
    const view = await call(admin, 'GET', `/admin/academic-years/${s.year}/calendar`);
    await call(admin, 'DELETE', `/admin/calendar-entries/${view.data.entries[0].id}`);
    const back = await call(admin, 'GET', registerUrl(D.WED10, s.p1, s.sec['10']!));
    expect(back.data.access.editable).toBe(true);
    expect(back.data.rows[0].status).toBe('A');
  });
});
