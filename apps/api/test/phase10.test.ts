/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
 * Phase 10 — dashboards, announcements and structured requests. TEST DATA ONLY: synthetic names in
 * throwaway databases; the school is configured through the real APIs. The clock is Monday
 * 21 September 2026, 09:00 IST.
 */
const NOW = '2026-06-01T00:00:00.000Z';
const MON = '2026-09-21';
const DAY = 86_400_000;

interface School {
  year: string;
  classX: string;
  xA: string;
  xB: string;
  p1: string;
  p2: string;
  maths: string;
  exam: string;
  esMaths: string;
  kumar: string; // class teacher of X-A
  priya: string; // class teacher of X-B
  arun: string; // subject teacher: Maths X-A (P1) and X-B (P2) on Monday; enters both sheets
  s1: string;
  s2: string;
  s3: string; // X-B
}

async function setup(h: TestApp, admin: Session, db: Kysely<Database>): Promise<School> {
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await call(admin, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  };
  const year = await ok('POST', '/admin/academic-years', {
    label: 'P10-2026',
    startDate: '2026-05-15',
    endDate: '2027-04-30',
  });
  await ok('POST', `/admin/academic-years/${year.id}/make-current`);
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
  const slot = (label: string) => day.slots.find((x: any) => x.label === label).id;
  const x = await ok('POST', '/admin/classes', { name: 'P10-X', displayOrder: 10 });
  await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
  const xc = await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'B' });
  const sec = (n: string) => xc.sections.find((s: any) => s.name === n).id;
  const maths = await ok('POST', '/admin/subjects', {
    name: 'P10 Maths',
    code: null,
    displayOrder: 1,
  });

  const teacher = async (username: string, name: string) =>
    linkTeacher(db, await seedAccount(h.deps, { username, role: 'TEACHER' }), name);
  const kumar = await teacher('p10.kumar', 'P10 Kumar');
  const priya = await teacher('p10.priya', 'P10 Priya');
  const arun = await teacher('p10.arun', 'P10 Arun');
  await ok('POST', `/admin/teachers/${arun}/subjects`, { subjectId: maths.id });
  await assignClassTeacher(db, kumar, year.id, sec('A'));
  await assignClassTeacher(db, priya, year.id, sec('B'));

  const student = async (username: string, section: string, roll: string) => {
    const id = await linkStudent(
      db,
      await seedAccount(h.deps, { username, role: 'STUDENT' }),
      `P10 Student ${username.slice(4)}`,
    );
    await db
      .insertInto('enrolments')
      .values({
        id: randomUUID(),
        student_id: id,
        academic_year_id: year.id,
        section_id: section,
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
  const s1 = await student('p10.s1', sec('A'), '1');
  const s2 = await student('p10.s2', sec('A'), '2');
  const s3 = await student('p10.s3', sec('B'), '1');

  // Published timetable: Arun teaches Maths to X-A (Mon P1) and X-B (Mon P2).
  await ok('POST', `/timetable/years/${year.id}/draft`);
  for (const [section, period] of [
    [sec('A'), slot('Period 1')],
    [sec('B'), slot('Period 2')],
  ] as const) {
    await ok('POST', `/timetable/years/${year.id}/draft/changes`, {
      sectionId: section,
      operations: [
        {
          op: 'create',
          id: randomUUID(),
          day: 'MON',
          periodId: period,
          sectionId: section,
          subjectId: maths.id,
          teacherId: arun,
        },
      ],
    });
  }
  await ok('POST', `/timetable/years/${year.id}/draft/publish`);

  const exam = await ok('POST', '/admin/exams', {
    academicYearId: year.id,
    name: 'P10 Mid Term',
    startDate: '2026-09-14',
    endDate: '2026-09-18',
    weightagePercent: 0,
    rankScope: 'SECTION',
    displayOrder: 1,
  });
  const subjects = await ok('PUT', `/admin/exams/${exam.id}/classes/${x.id}/subjects`, {
    subjects: [{ subjectId: maths.id, theoryMax: 100, passMarks: 35 }],
  });
  await ok('PUT', `/admin/exams/${exam.id}/stage`, { stage: 'OPEN' });
  for (const section of [sec('A'), sec('B')]) {
    await ok('PUT', `/admin/exam-subjects/${subjects[0].id}/sections/${section}/teacher`, {
      teacherId: arun,
    });
  }
  return {
    year: year.id,
    classX: x.id,
    xA: sec('A'),
    xB: sec('B'),
    p1: slot('Period 1'),
    p2: slot('Period 2'),
    maths: maths.id,
    exam: exam.id,
    esMaths: subjects[0].id,
    kumar,
    priya,
    arun,
    s1,
    s2,
    s3,
  };
}

describe.each<TestDriver>(['sqlite', 'postgres'])(
  'dashboards, announcements, requests (%s)',
  (driver) => {
    let h: TestApp;
    let db: Kysely<Database>;
    let clock: MutableClock;
    let admin: Session;
    let s: School;

    beforeEach(async () => {
      const opened = await openTestDatabase(driver);
      db = opened.db;
      clock = new MutableClock('2026-09-21T03:30:00.000Z');
      h = await buildTestApp({ dataStore: opened.store, clock });
      admin = await adminSession(h);
      s = await setup(h, admin, db);
    }, 120_000);
    afterEach(async () => {
      await h.close();
    });

    const register = (who: Session, sectionId: string, periodId: string, marks: unknown[]) =>
      call(who, 'PUT', '/attendance/register', {
        date: MON,
        periodId,
        sectionId,
        revision: null,
        marks,
      });
    const sheetKey = (sectionId: string) => ({ examSubjectId: s.esMaths, sectionId });
    /** Saves marks on top of the sheet's current revision (assigning the teacher created it). */
    const saveMarks = async (who: Session, sectionId: string, marks: any[]) => {
      const sheet = await call(
        who,
        'GET',
        `/marks/sheet?examSubjectId=${s.esMaths}&sectionId=${sectionId}`,
      );
      return call(who, 'PUT', '/marks/sheet', {
        ...sheetKey(sectionId),
        revision: sheet.data.revision,
        marks,
      });
    };
    const theory = (studentId: string, value: number | null) => ({
      studentId,
      theory: value,
      internal: null,
      practical: null,
    });
    const auditActions = async (entityType: string, entityId: string) =>
      (
        await db
          .selectFrom('audit_logs')
          .select(['action'])
          .where('entity_type', '=', entityType)
          .where('entity_id', '=', entityId)
          .orderBy('occurred_at')
          .execute()
      ).map((r) => r.action);

    // ---- Dashboards ----------------------------------------------------------------------------

    it('dashboard: administrator overview comes from the existing services', async () => {
      const anon = { app: h.app, cookie: '' };
      expect((await call(anon, 'GET', '/dashboard')).status).toBe(401);

      let d = (await call(admin, 'GET', '/dashboard')).data;
      expect(d.date).toBe(MON);
      expect(d.academicYear).toMatchObject({ id: s.year, label: 'P10-2026' });
      expect(d.admin.counts).toEqual({
        activeStudents: 3,
        activeTeachers: 3,
        activeClasses: 1,
        activeSections: 2,
      });
      // Counts are the same totals the management lists report.
      const studentList = await call(admin, 'GET', '/admin/students?status=ACTIVE&pageSize=5');
      expect(d.admin.counts.activeStudents).toBe(studentList.data.total);
      expect(d.admin.today.schoolDay).toBe(true);
      expect(d.admin.today.attendance).toMatchObject({ lessons: 2, taken: 0, workingSections: 2 });
      expect(d.admin.today.attendance.pending).toHaveLength(2);
      expect(d.admin.exams).toHaveLength(1);
      expect(d.admin.exams[0]).toMatchObject({
        name: 'P10 Mid Term',
        stage: 'OPEN',
        sheets: { total: 2, notStarted: 2, draft: 0, submitted: 0, unlocked: 0 },
      });
      // Other roles get no administrator block.
      const arun = await sessionFor(h, 'p10.arun');
      expect((await call(arun, 'GET', '/dashboard')).data.admin).toBeNull();

      // Arun takes X-A's register; the overview matches the class-day counts exactly.
      const reg = await register(arun, s.xA, s.p1, [
        { studentId: s.s1, status: 'P' },
        { studentId: s.s2, status: 'A' },
      ]);
      expect(reg.status, reg.raw).toBe(200);
      await saveMarks(arun, s.xA, [theory(s.s1, 50)]);
      d = (await call(admin, 'GET', '/dashboard')).data;
      expect(d.admin.today.attendance).toMatchObject({ lessons: 2, taken: 1 });
      expect(d.admin.today.attendance.pending.map((p: any) => p.section.sectionId)).toEqual([s.xB]);
      const dayA = (await call(admin, 'GET', `/attendance/class-day?date=${MON}&sectionId=${s.xA}`))
        .data;
      const dayB = (await call(admin, 'GET', `/attendance/class-day?date=${MON}&sectionId=${s.xB}`))
        .data;
      for (const key of ['total', 'marked', 'notMarked', 'P', 'A', 'L', 'C'] as const) {
        expect(d.admin.today.attendance.counts[key], key).toBe(dayA.counts[key] + dayB.counts[key]);
      }
      expect(d.admin.exams[0].sheets).toMatchObject({ notStarted: 1, draft: 1 });
    });

    it('dashboard: teacher lessons and mark-entry tasks reuse attendance and Phase 8B state', async () => {
      const arun = await sessionFor(h, 'p10.arun');
      const kumar = await sessionFor(h, 'p10.kumar');
      let d = (await call(arun, 'GET', '/dashboard')).data;
      // Exactly the attendance service's lessons for today (published timetable + calendar).
      const lessons = (await call(arun, 'GET', `/attendance/lessons?date=${MON}`)).data;
      expect(d.teaching.lessons).toEqual(lessons);
      expect(d.teaching.lessons.lessons.map((l: any) => l.period.label)).toEqual([
        'Period 1',
        'Period 2',
      ]);
      expect(d.teaching.lessons.lessons[0].attendance.taken).toBe(false);
      expect(d.teaching.markTasks.map((t: any) => t.state)).toEqual(['NOT_STARTED', 'NOT_STARTED']);
      expect(d.classes).toEqual([]);

      // Partial draft for X-A → draft; every student entered in X-B → ready to submit.
      const partial = await saveMarks(arun, s.xA, [theory(s.s1, 70)]);
      expect(partial.status, partial.raw).toBe(200);
      await saveMarks(arun, s.xB, [theory(s.s3, 55)]);
      await register(arun, s.xA, s.p1, [{ studentId: s.s1, status: 'P' }]);
      d = (await call(arun, 'GET', '/dashboard')).data;
      expect(d.teaching.lessons.lessons[0].attendance.taken).toBe(true);
      const byClass = (state: string) =>
        d.teaching.markTasks.filter((t: any) => t.state === state).map((t: any) => t.sectionName);
      expect(byClass('READY_TO_SUBMIT')).toEqual(['B']);
      expect(byClass('DRAFT')).toEqual(['A']);
      expect(d.teaching.markTasks.find((t: any) => t.sectionName === 'A')).toMatchObject({
        entered: 1,
        total: 2,
      });
      const a = await saveMarks(arun, s.xA, [theory(s.s1, 70), theory(s.s2, 40)]);
      expect(a.status, a.raw).toBe(200);

      // Submit → Submitted; the class teacher unlocks → Needs correction.
      const sub = await call(arun, 'POST', '/marks/sheet/submit', {
        ...sheetKey(s.xA),
        revision: a.data.revision,
      });
      expect(sub.status, sub.raw).toBe(200);
      d = (await call(arun, 'GET', '/dashboard')).data;
      expect(byClass('SUBMITTED')).toEqual(['A']);
      const un = await call(kumar, 'POST', '/marks/sheet/unlock', {
        ...sheetKey(s.xA),
        revision: sub.data.revision,
        reason: 'Recheck the totals',
      });
      expect(un.status, un.raw).toBe(200);
      d = (await call(arun, 'GET', '/dashboard')).data;
      expect(byClass('NEEDS_CORRECTION')).toEqual(['A']);

      // A class teacher who is not the entry teacher has no mark-entry tasks.
      const priya = await sessionFor(h, 'p10.priya');
      expect((await call(priya, 'GET', '/dashboard')).data.teaching.markTasks).toEqual([]);
    });

    it('dashboard: class teacher sees only their own section, from the class-day and marks services', async () => {
      const kumar = await sessionFor(h, 'p10.kumar');
      const arun = await sessionFor(h, 'p10.arun');
      await register(arun, s.xA, s.p1, [
        { studentId: s.s1, status: 'P' },
        { studentId: s.s2, status: 'A' },
      ]);
      const ach = await call(admin, 'POST', '/admin/achievement-categories', {
        name: 'P10 Sports',
        description: null,
        displayOrder: 1,
      });
      const created = await call(admin, 'POST', '/achievements', {
        studentId: s.s1,
        academicYearId: s.year,
        categoryId: ach.data.id,
        title: 'P10 Chess winner',
        description: null,
        achievedOn: '2026-09-10',
      });
      expect(created.status, created.raw).toBe(201);

      const d = (await call(kumar, 'GET', '/dashboard')).data;
      expect(d.classes).toHaveLength(1);
      const c = d.classes[0];
      expect(c.section).toMatchObject({ sectionId: s.xA, className: 'P10-X', sectionName: 'A' });
      expect(c.studentCount).toBe(2);
      const day = (await call(kumar, 'GET', `/attendance/class-day?date=${MON}&sectionId=${s.xA}`))
        .data;
      expect(c.attendance).toMatchObject({
        schoolDay: true,
        lessons: day.periods.length,
        taken: 1,
        counts: day.counts,
        notTaken: [],
        absentStudents: 1,
      });
      expect(c.exams).toEqual([
        expect.objectContaining({ subjectsSubmitted: 0, subjectsTotal: 1, behaviour: null }),
      ]);
      expect(c.achievements.map((a: any) => a.title)).toEqual(['P10 Chess winner']);
      // Nothing about X-B anywhere in Kumar's dashboard.
      const raw = (await call(kumar, 'GET', '/dashboard')).raw;
      expect(raw).not.toContain(s.xB);
      expect(raw).not.toContain('P10 Student s3');
    });

    it('dashboard: a student sees only their own day, attendance, results and records', async () => {
      const s1 = await sessionFor(h, 'p10.s1');
      const arun = await sessionFor(h, 'p10.arun');
      let d = (await call(s1, 'GET', '/dashboard')).data;
      expect(d.admin).toBeNull();
      expect(d.teaching).toBeNull();
      expect(d.classes).toEqual([]);
      expect(d.student.student).toMatchObject({ fullName: 'P10 Student s1', rollNumber: '1' });
      expect(d.student.section).toMatchObject({ sectionId: s.xA });
      expect(d.student.today.lessons).toHaveLength(1);
      expect(d.student.today.lessons[0]).toMatchObject({
        period: { label: 'Period 1', startTime: '08:00' },
        subject: { name: 'P10 Maths' },
        teacherName: 'P10 Arun',
        status: '-',
      });
      expect(d.student.latestResult).toBeNull();
      expect(d.student.behaviour).toBeNull();
      expect(d.student.achievements).toEqual([]);

      await register(arun, s.xA, s.p1, [
        { studentId: s.s1, status: 'P' },
        { studentId: s.s2, status: 'A' },
      ]);
      const a = await saveMarks(arun, s.xA, [theory(s.s1, 70), theory(s.s2, 40)]);
      await call(arun, 'POST', '/marks/sheet/submit', {
        ...sheetKey(s.xA),
        revision: a.data.revision,
      });
      d = (await call(s1, 'GET', '/dashboard')).data;
      expect(d.student.today.lessons[0].status).toBe('P');
      // Same numbers as My attendance over the same range (P ÷ (P + A)).
      const mine = (
        await call(s1, 'GET', `/attendance/me?from=${d.student.attendance.from}&to=${MON}`)
      ).data;
      expect(d.student.attendance.counts).toEqual(mine.counts);
      expect(d.student.attendance.from).toBe('2026-08-25');
      expect(d.student.attendance.counts).toMatchObject({ P: 1, A: 0, percentage: 100 });
      // Latest result: Phase 8B visibility (submitted subject).
      expect(d.student.latestResult).toMatchObject({
        exam: { name: 'P10 Mid Term' },
        availableCount: 1,
      });
      const result = (await call(s1, 'GET', `/results/me/exams/${s.exam}`)).data;
      expect(d.student.latestResult.summary).toEqual(result.summary);

      // Nothing about classmates (s2 was absent, scored 40).
      const raw = (await call(s1, 'GET', '/dashboard')).raw;
      expect(raw).not.toContain('P10 Student s2');
      expect(raw).not.toContain(s.s2);
      // Query parameters cannot point the dashboard at someone else.
      const crafted = await call(s1, 'GET', `/dashboard?studentId=${s.s2}`);
      expect(crafted.raw).not.toContain(s.s2);
      // The student-day endpoint is the student's own only.
      expect((await call(admin, 'GET', `/attendance/me/day?date=${MON}`)).status).toBe(409);
    });

    it('dashboard: a holiday shows no lessons and no pending attendance anywhere', async () => {
      const entry = await call(admin, 'POST', `/admin/academic-years/${s.year}/calendar`, {
        date: MON,
        status: 'HOLIDAY',
        scope: 'SCHOOL',
        classIds: [],
        sectionIds: [],
        reason: 'P10 Holiday',
        note: null,
      });
      expect(entry.status, entry.raw).toBe(201);
      const d = (await call(admin, 'GET', '/dashboard')).data;
      expect(d.admin.today.schoolDay).toBe(false);
      expect(d.admin.today.notes).toEqual(['Holiday: P10 Holiday (whole school)']);
      expect(d.admin.today.attendance).toMatchObject({ lessons: 0, taken: 0, pending: [] });
      const arun = (await call(await sessionFor(h, 'p10.arun'), 'GET', '/dashboard')).data;
      expect(arun.teaching.lessons).toMatchObject({ schoolDay: false, lessons: [] });
      const kumar = (await call(await sessionFor(h, 'p10.kumar'), 'GET', '/dashboard')).data;
      expect(kumar.classes[0].attendance).toMatchObject({
        schoolDay: false,
        lessons: 0,
        notTaken: [],
      });
      const s1 = (await call(await sessionFor(h, 'p10.s1'), 'GET', '/dashboard')).data;
      expect(s1.student.today).toMatchObject({ schoolDay: false, lessons: [] });
    });

    // ---- Announcements -------------------------------------------------------------------------

    const post = (who: Session, announcement: any, publish = true) =>
      call(who, 'POST', '/announcements', { announcement, publish });
    const body = (title: string, audience: string, extra: any = {}) => ({
      title,
      body: `${title} — details`,
      audience,
      classId: null,
      sectionId: null,
      expiresOn: null,
      ...extra,
    });
    const feedTitles = async (who: Session) =>
      ((await call(who, 'GET', '/announcements/feed?pageSize=50')).data.items as any[]).map(
        (a) => a.title,
      );

    it('announcements: audiences, drafts, archive and expiry decide who reads what', async () => {
      const s1 = await sessionFor(h, 'p10.s1');
      const s3 = await sessionFor(h, 'p10.s3');
      const arun = await sessionFor(h, 'p10.arun');
      const kumar = await sessionFor(h, 'p10.kumar');
      const priya = await sessionFor(h, 'p10.priya');

      const school = await post(admin, body('School news', 'SCHOOL'));
      expect(school.status, school.raw).toBe(201);
      expect(school.data).toMatchObject({
        status: 'PUBLISHED',
        audienceLabel: 'Whole school',
        canManage: true,
      });
      const draft = await post(admin, body('Draft news', 'SCHOOL'), false);
      expect(draft.data.status).toBe('DRAFT');
      const staff = await post(admin, body('Staff meeting', 'STAFF'));
      const cls = await post(admin, body('Class X trip', 'CLASS', { classId: s.classX }));
      expect(cls.data.audienceLabel).toBe('P10-X (all sections)');
      const secA = await post(admin, body('X-A notice', 'SECTION', { sectionId: s.xA }));
      expect(secA.data).toMatchObject({ audienceLabel: 'P10-X A', classId: s.classX });

      expect((await feedTitles(s1)).sort()).toEqual(['Class X trip', 'School news', 'X-A notice']);
      expect((await feedTitles(s3)).sort()).toEqual(['Class X trip', 'School news']);
      expect((await feedTitles(arun)).sort()).toEqual(['School news', 'Staff meeting']);
      expect((await feedTitles(kumar)).sort()).toEqual([
        'Class X trip',
        'School news',
        'Staff meeting',
        'X-A notice',
      ]);
      expect((await feedTitles(priya)).sort()).toEqual([
        'Class X trip',
        'School news',
        'Staff meeting',
      ]);
      expect((await feedTitles(admin)).sort()).toEqual([
        'Class X trip',
        'School news',
        'Staff meeting',
        'X-A notice',
      ]);

      // Opening one directly follows the same rules; unknown ids answer the same way.
      expect((await call(s1, 'GET', `/announcements/${secA.data.id}`)).status).toBe(200);
      const denied = await call(s3, 'GET', `/announcements/${secA.data.id}`);
      const unknown = await call(s3, 'GET', `/announcements/${randomUUID()}`);
      expect(denied.status).toBe(403);
      expect(unknown.status).toBe(403);
      expect(denied.error.message).toBe(unknown.error.message);
      expect((await call(s1, 'GET', `/announcements/${draft.data.id}`)).status).toBe(403);
      expect((await call(s1, 'GET', `/announcements/${staff.data.id}`)).status).toBe(403);
      expect((await call(arun, 'GET', `/announcements/${secA.data.id}`)).status).toBe(403);

      // Publish the draft → visible; archive → hidden; restore → visible again.
      const pub = await call(admin, 'POST', `/announcements/${draft.data.id}/publish`);
      expect(pub.status, pub.raw).toBe(200);
      expect(await feedTitles(s1)).toContain('Draft news');
      expect((await call(admin, 'POST', `/announcements/${draft.data.id}/archive`)).status).toBe(
        200,
      );
      expect(await feedTitles(s1)).not.toContain('Draft news');
      expect((await call(s1, 'GET', `/announcements/${draft.data.id}`)).status).toBe(403);
      const restored = await call(admin, 'POST', `/announcements/${draft.data.id}/restore`);
      expect(restored.data.status).toBe('PUBLISHED');
      expect(await feedTitles(s1)).toContain('Draft news');

      // Expiry: shown through its expiry date, hidden the day after. A past date is refused.
      const past = await post(admin, body('Old', 'SCHOOL', { expiresOn: '2026-09-20' }));
      expect(past.status).toBe(409);
      expect(past.error.details[0].path).toBe('body.announcement.expiresOn');
      await post(admin, body('Today only', 'SCHOOL', { expiresOn: MON }));
      expect(await feedTitles(s1)).toContain('Today only');
      clock.advance(DAY);
      const s1Tomorrow = await sessionFor(h, 'p10.s1');
      expect(await feedTitles(s1Tomorrow)).not.toContain('Today only');
      const adminTomorrow = await sessionFor(h, 'test.admin');
      const managed = await call(adminTomorrow, 'GET', '/announcements?pageSize=50');
      expect(managed.data.items.find((a: any) => a.title === 'Today only')).toMatchObject({
        status: 'PUBLISHED',
        expired: true,
      });

      expect(await auditActions('announcement', draft.data.id)).toEqual([
        'announcement.created',
        'announcement.published',
        'announcement.archived',
        'announcement.restored',
      ]);
    });

    it('announcements: class teachers manage only their own section; others cannot manage', async () => {
      const kumar = await sessionFor(h, 'p10.kumar');
      const arun = await sessionFor(h, 'p10.arun');
      const s1 = await sessionFor(h, 'p10.s1');
      const s2 = await sessionFor(h, 'p10.s2');
      const s3 = await sessionFor(h, 'p10.s3');

      const options = (await call(kumar, 'GET', '/announcements/options')).data;
      expect(options.audiences).toEqual(['SECTION']);
      expect(options.sections.map((x: any) => x.sectionId)).toEqual([s.xA]);

      const own = await post(kumar, body('Bring lab coats', 'SECTION', { sectionId: s.xA }));
      expect(own.status, own.raw).toBe(201);
      expect(own.data.author).toBe('P10 Kumar');
      expect(await feedTitles(s2)).toContain('Bring lab coats');
      expect(await feedTitles(s3)).not.toContain('Bring lab coats');

      for (const bad of [
        body('Other class', 'SECTION', { sectionId: s.xB }),
        body('Everyone', 'SCHOOL'),
        body('Class', 'CLASS', { classId: s.classX }),
        body('Staff', 'STAFF'),
      ]) {
        expect((await post(kumar, bad)).status, bad.title).toBe(403);
      }
      // Subject teachers and students cannot manage at all.
      expect((await post(arun, body('Mine', 'SECTION', { sectionId: s.xA }))).status).toBe(403);
      expect((await post(s1, body('Mine', 'SCHOOL'))).status).toBe(403);
      expect((await call(arun, 'GET', '/announcements')).status).toBe(403);
      expect((await call(s1, 'GET', '/announcements')).status).toBe(403);
      // Validation: a section audience needs a section.
      const invalid = await post(admin, body('No section', 'SECTION'));
      expect(invalid.status).toBe(400);

      // Kumar edits his own; cannot move it to another section or touch an admin school notice.
      const edit = await call(kumar, 'PUT', `/announcements/${own.data.id}`, {
        ...body('Bring lab coats and goggles', 'SECTION', { sectionId: s.xA }),
      });
      expect(edit.status, edit.raw).toBe(200);
      expect(
        (
          await call(kumar, 'PUT', `/announcements/${own.data.id}`, {
            ...body('Moved', 'SECTION', { sectionId: s.xB }),
          })
        ).status,
      ).toBe(403);
      const school = await post(admin, body('School news', 'SCHOOL'));
      expect(
        (await call(kumar, 'PUT', `/announcements/${school.data.id}`, body('X', 'SCHOOL'))).status,
      ).toBe(403);
      expect((await call(kumar, 'POST', `/announcements/${school.data.id}/archive`)).status).toBe(
        403,
      );
      // Kumar's management list holds only his section's announcements.
      const list = (await call(kumar, 'GET', '/announcements')).data;
      expect(list.items.map((a: any) => a.title)).toEqual(['Bring lab coats and goggles']);
      // The administrator re-targets it: audited as a scope change.
      const moved = await call(admin, 'PUT', `/announcements/${own.data.id}`, {
        ...body('Bring lab coats and goggles', 'SCHOOL'),
      });
      expect(moved.status).toBe(200);
      expect(await auditActions('announcement', own.data.id)).toEqual([
        'announcement.created',
        'announcement.published',
        'announcement.updated',
        'announcement.retargeted',
      ]);
    });

    // ---- Requests ------------------------------------------------------------------------------

    const counts = async () => ({
      attendance: (await db.selectFrom('attendance_records').selectAll().execute()).length,
      marks: JSON.stringify(
        await db.selectFrom('mark_entries').selectAll().orderBy('id').execute(),
      ),
      student: JSON.stringify(
        await db.selectFrom('students').selectAll().where('id', '=', s.s1).execute(),
      ),
    });

    it('requests: students create the three types about their own data only', async () => {
      const s1 = await sessionFor(h, 'p10.s1');
      const arun = await sessionFor(h, 'p10.arun');
      await register(arun, s.xA, s.p1, [{ studentId: s.s1, status: 'A' }]);

      const options = (await call(s1, 'GET', '/requests/options')).data;
      expect(options.section).toMatchObject({ sectionId: s.xA });
      expect(options.exams).toEqual([
        { id: s.exam, name: 'P10 Mid Term', subjects: [{ id: s.maths, name: 'P10 Maths' }] },
      ]);
      expect(options).toMatchObject({ attendanceTo: MON, activeCount: 0, activeLimit: 10 });
      const day = (await call(s1, 'GET', `/attendance/me/day?date=${MON}`)).data;
      expect(day.lessons.map((l: any) => l.period.id)).toEqual([s.p1]);

      const att = await call(s1, 'POST', '/requests', {
        type: 'ATTENDANCE_ISSUE',
        date: MON,
        periodId: s.p1,
        description: 'I was present in Maths today.',
      });
      expect(att.status, att.raw).toBe(201);
      expect(att.data.request).toMatchObject({
        type: 'ATTENDANCE_ISSUE',
        status: 'OPEN',
        summary: 'Attendance on 21 Sep 2026, Period 1 (P10 Maths)',
        related: { date: MON, period: { id: s.p1 }, subject: { id: s.maths } },
        assignedTo: { name: 'P10 Kumar' },
        requester: { name: 'P10 Student s1', role: 'STUDENT' },
        actions: { startReview: false, resolve: false, close: false, reopen: false, assign: false },
      });
      expect(att.data.history).toEqual([]);
      // Period 2 is X-B's lesson, not s1's; future dates are refused.
      const wrong = await call(s1, 'POST', '/requests', {
        type: 'ATTENDANCE_ISSUE',
        date: MON,
        periodId: s.p2,
        description: 'Wrong period for me',
      });
      expect(wrong.status).toBe(409);
      expect(wrong.error.details[0].path).toBe('body.periodId');
      const future = await call(s1, 'POST', '/requests', {
        type: 'ATTENDANCE_ISSUE',
        date: '2026-09-28',
        periodId: s.p1,
        description: 'Next week attendance',
      });
      expect(future.status).toBe(409);

      const res = await call(s1, 'POST', '/requests', {
        type: 'RESULT_CLARIFICATION',
        examId: s.exam,
        subjectId: s.maths,
        description: 'Please recheck my Maths total.',
      });
      expect(res.status, res.raw).toBe(201);
      expect(res.data.request).toMatchObject({
        summary: 'P10 Mid Term — P10 Maths',
        related: { exam: { id: s.exam }, subject: { id: s.maths } },
        assignedTo: { name: 'P10 Kumar' },
      });
      const badSubject = await call(s1, 'POST', '/requests', {
        type: 'RESULT_CLARIFICATION',
        examId: s.exam,
        subjectId: randomUUID(),
        description: 'Some other subject',
      });
      expect(badSubject.status).toBe(409);

      const prof = await call(s1, 'POST', '/requests', {
        type: 'PROFILE_CORRECTION',
        field: 'DATE_OF_BIRTH',
        description: 'My date of birth is wrong.',
      });
      expect(prof.status, prof.raw).toBe(201);
      expect(prof.data.request).toMatchObject({
        summary: 'Profile: Date of birth',
        assignedTo: null,
      });
      // Too short a description is a validation error.
      expect(
        (
          await call(s1, 'POST', '/requests', {
            type: 'PROFILE_CORRECTION',
            field: 'NAME',
            description: 'short',
          })
        ).status,
      ).toBe(400);

      // Own requests only.
      expect((await call(s1, 'GET', '/requests/mine')).data.total).toBe(3);
      const s2 = await sessionFor(h, 'p10.s2');
      expect((await call(s2, 'GET', '/requests/mine')).data.total).toBe(0);
      const other = await call(s2, 'GET', `/requests/${att.data.request.id}`);
      const missing = await call(s2, 'GET', `/requests/${randomUUID()}`);
      expect(other.status).toBe(403);
      expect(missing.status).toBe(403);
      expect(other.error.message).toBe(missing.error.message);
      // Staff lists and staff-only actions are refused to students.
      expect((await call(s1, 'GET', '/requests')).status).toBe(403);
      const id = att.data.request.id;
      expect(
        (
          await call(s1, 'POST', `/requests/${id}/status`, {
            status: 'RESOLVED',
            note: 'done!',
            revision: 1,
          })
        ).status,
      ).toBe(403);
      expect(
        (await call(s1, 'POST', `/requests/${id}/assign`, { assigneeUserId: null, revision: 1 }))
          .status,
      ).toBe(403);
      // Staff cannot create requests.
      expect(
        (
          await call(admin, 'POST', '/requests', {
            type: 'PROFILE_CORRECTION',
            field: 'NAME',
            description: 'Admin making one',
          })
        ).status,
      ).toBe(403);
      // The student's dashboard lists their open requests.
      const dash = (await call(s1, 'GET', '/dashboard')).data;
      expect(dash.requests.active).toBe(3);
      expect(await auditActions('request', id)).toEqual(['request.created']);
    });

    it('requests: reviewers by scope, workflow, history and no data changes', async () => {
      const s1 = await sessionFor(h, 'p10.s1');
      const s3 = await sessionFor(h, 'p10.s3');
      const kumar = await sessionFor(h, 'p10.kumar');
      const priya = await sessionFor(h, 'p10.priya');
      const arun = await sessionFor(h, 'p10.arun');
      await register(arun, s.xA, s.p1, [{ studentId: s.s1, status: 'A' }]);
      const att = (
        await call(s1, 'POST', '/requests', {
          type: 'ATTENDANCE_ISSUE',
          date: MON,
          periodId: s.p1,
          description: 'I was present in Maths today.',
        })
      ).data.request;
      const prof = (
        await call(s1, 'POST', '/requests', {
          type: 'PROFILE_CORRECTION',
          field: 'ADDRESS',
          description: 'My address has changed.',
        })
      ).data.request;
      await call(s3, 'POST', '/requests', {
        type: 'PROFILE_CORRECTION',
        field: 'NAME',
        description: 'Spelling of my name.',
      });
      const before = await counts();

      // Scope: Kumar — his section's attendance/result requests; Priya — none of X-A's;
      // Arun (subject teacher) — no access; administrators — everything.
      const kList = (await call(kumar, 'GET', '/requests')).data;
      expect(kList.items.map((r: any) => r.id)).toEqual([att.id]);
      expect((await call(priya, 'GET', '/requests')).data.total).toBe(0);
      expect((await call(arun, 'GET', '/requests')).status).toBe(403);
      expect((await call(admin, 'GET', '/requests')).data.total).toBe(3);
      expect((await call(admin, 'GET', `/requests?sectionId=${s.xB}`)).data.total).toBe(1);
      expect((await call(admin, 'GET', '/requests?type=PROFILE_CORRECTION')).data.total).toBe(2);
      expect((await call(admin, 'GET', `/requests?from=${MON}&to=${MON}`)).data.total).toBe(3);
      expect((await call(admin, 'GET', '/requests?from=2026-09-22')).data.total).toBe(0);
      expect((await call(kumar, 'GET', `/requests/${prof.id}`)).status).toBe(403);
      expect((await call(priya, 'GET', `/requests/${att.id}`)).status).toBe(403);
      expect(
        (
          await call(priya, 'POST', `/requests/${att.id}/status`, {
            status: 'IN_REVIEW',
            note: null,
            revision: 1,
          })
        ).status,
      ).toBe(403);
      expect((await call(kumar, 'GET', '/dashboard')).data.requests.active).toBe(1);

      // Workflow: Open → In review → Resolved → Closed → reopened.
      const detail = (await call(kumar, 'GET', `/requests/${att.id}`)).data;
      expect(detail.request.actions).toMatchObject({
        startReview: true,
        resolve: true,
        assign: false,
      });
      expect(detail.assignees).toEqual([]);
      clock.advance(60_000);
      const review = await call(kumar, 'POST', `/requests/${att.id}/status`, {
        status: 'IN_REVIEW',
        note: null,
        revision: 1,
      });
      expect(review.status, review.raw).toBe(200);
      expect(review.data.request).toMatchObject({ status: 'IN_REVIEW', revision: 2 });
      const stale = await call(kumar, 'POST', `/requests/${att.id}/status`, {
        status: 'RESOLVED',
        note: 'Corrected the register.',
        revision: 1,
      });
      expect(stale.status).toBe(409);
      const noNote = await call(kumar, 'POST', `/requests/${att.id}/status`, {
        status: 'RESOLVED',
        note: '',
        revision: 2,
      });
      expect(noNote.status).toBe(409);
      expect(noNote.error.details[0].path).toBe('body.note');
      clock.advance(60_000);
      const resolved = await call(kumar, 'POST', `/requests/${att.id}/status`, {
        status: 'RESOLVED',
        note: 'Checked with Mr Arun; the register is now correct.',
        revision: 2,
      });
      expect(resolved.status, resolved.raw).toBe(200);
      expect(resolved.data.request).toMatchObject({
        status: 'RESOLVED',
        resolvedBy: 'P10 Kumar',
      });
      // The student sees the outcome but no staff history.
      const mine = (await call(s1, 'GET', `/requests/${att.id}`)).data;
      expect(mine.request).toMatchObject({
        status: 'RESOLVED',
        resolutionNote: 'Checked with Mr Arun; the register is now correct.',
      });
      expect(mine.history).toEqual([]);
      clock.advance(60_000);
      const closed = await call(kumar, 'POST', `/requests/${att.id}/status`, {
        status: 'CLOSED',
        note: null,
        revision: 3,
      });
      expect(closed.data.request.status).toBe('CLOSED');
      expect(
        (
          await call(kumar, 'POST', `/requests/${att.id}/status`, {
            status: 'OPEN',
            note: '',
            revision: 4,
          })
        ).status,
      ).toBe(409);
      clock.advance(60_000);
      const reopened = await call(kumar, 'POST', `/requests/${att.id}/status`, {
        status: 'OPEN',
        note: 'Student says another lesson is wrong too.',
        revision: 4,
      });
      expect(reopened.data.request).toMatchObject({
        status: 'OPEN',
        resolutionNote: null,
        resolvedAt: null,
        closedAt: null,
      });
      const history = (await call(kumar, 'GET', `/requests/${att.id}`)).data.history;
      expect(history.map((x: any) => x.action)).toEqual([
        'Request created',
        'Review started',
        'Resolved',
        'Closed',
        'Reopened',
      ]);
      expect(history[2]).toMatchObject({
        actor: 'P10 Kumar',
        note: 'Checked with Mr Arun; the register is now correct.',
      });

      // Closing an unresolved request needs a reason; it becomes the resolution note.
      const closeNoNote = await call(admin, 'POST', `/requests/${prof.id}/status`, {
        status: 'CLOSED',
        note: null,
        revision: 1,
      });
      expect(closeNoNote.status).toBe(409);

      // Assignment: administrators only, to administrators (profile corrections) or the class teacher.
      const adminDetail = (await call(admin, 'GET', `/requests/${prof.id}`)).data;
      expect(adminDetail.assignees.map((a: any) => a.name)).not.toContain('P10 Kumar');
      const toKumar = await call(admin, 'POST', `/requests/${prof.id}/assign`, {
        assigneeUserId: (await call(admin, 'GET', `/requests/${att.id}`)).data.assignees.find(
          (a: any) => a.name === 'P10 Kumar',
        ).userId,
        revision: 1,
      });
      expect(toKumar.status).toBe(409);
      const adminUser = adminDetail.assignees[0].userId;
      const assigned = await call(admin, 'POST', `/requests/${prof.id}/assign`, {
        assigneeUserId: adminUser,
        revision: 1,
      });
      expect(assigned.status, assigned.raw).toBe(200);
      expect(assigned.data.request.assignedTo.userId).toBe(adminUser);
      expect(
        (
          await call(kumar, 'POST', `/requests/${att.id}/assign`, {
            assigneeUserId: null,
            revision: 5,
          })
        ).status,
      ).toBe(403);

      // Handling requests changed nothing else.
      expect(await counts()).toEqual(before);
      expect(await auditActions('request', att.id)).toEqual([
        'request.created',
        'request.review_started',
        'request.resolved',
        'request.closed',
        'request.reopened',
      ]);
      expect(await auditActions('request', prof.id)).toEqual([
        'request.created',
        'request.assigned',
      ]);
    });

    it('requests: a student can have at most 10 waiting requests', async () => {
      const s2 = await sessionFor(h, 'p10.s2');
      for (let i = 0; i < 10; i += 1) {
        const r = await call(s2, 'POST', '/requests', {
          type: 'PROFILE_CORRECTION',
          field: 'OTHER',
          description: `Correction number ${i + 1}`,
        });
        expect(r.status).toBe(201);
      }
      const eleventh = await call(s2, 'POST', '/requests', {
        type: 'PROFILE_CORRECTION',
        field: 'OTHER',
        description: 'One more correction',
      });
      expect(eleventh.status).toBe(409);
    });
  },
);
