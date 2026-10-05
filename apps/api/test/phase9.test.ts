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
 * Phase 9 — Student portal, exam-based behaviour and achievements. TEST DATA ONLY: synthetic
 * names in throwaway databases; everything configured through the real APIs. The clock is Monday
 * 21 September 2026, 09:00 IST; the exam ran 14–18 September.
 */
const NOW = '2026-06-01T00:00:00.000Z';
const MON = '2026-09-21';

interface School {
  year: string;
  xA: string;
  xB: string;
  period: string;
  maths: string;
  exam: string;
  esMaths: string;
  cats: { discipline: string; participation: string; old: string };
  achCats: { sports: string; academic: string; retired: string };
  kumar: string; // class teacher of X-A
  priya: string; // class teacher of X-B
  arun: string; // subject teacher (teaches X-A in the timetable)
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
    label: 'P9-2026',
    startDate: '2026-05-15',
    endDate: '2027-04-30',
  });
  await ok('POST', `/admin/academic-years/${year.id}/make-current`);
  await ok('PUT', `/admin/academic-years/${year.id}/working-days`, {
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  });
  const day = await ok('POST', `/admin/academic-years/${year.id}/periods`, {
    kind: 'LESSON',
    label: 'Period 1',
    periodNumber: 1,
    startTime: '08:00',
    endTime: '08:45',
  });
  const period = day.slots.find((x: any) => x.label === 'Period 1').id;
  const x = await ok('POST', '/admin/classes', { name: 'P9-X', displayOrder: 10 });
  await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
  const xc = await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'B' });
  const sec = (n: string) => xc.sections.find((s: any) => s.name === n).id;
  const maths = await ok('POST', '/admin/subjects', {
    name: 'P9 Maths',
    code: null,
    displayOrder: 1,
  });

  const teacher = async (username: string, name: string) =>
    linkTeacher(db, await seedAccount(h.deps, { username, role: 'TEACHER' }), name);
  const kumar = await teacher('p9.kumar', 'P9 Kumar');
  const priya = await teacher('p9.priya', 'P9 Priya');
  const arun = await teacher('p9.arun', 'P9 Arun');
  await ok('POST', `/admin/teachers/${arun}/subjects`, { subjectId: maths.id });
  await assignClassTeacher(db, kumar, year.id, sec('A'));
  await assignClassTeacher(db, priya, year.id, sec('B'));

  const student = async (username: string, section: string, roll: string) => {
    const id = await linkStudent(
      db,
      await seedAccount(h.deps, { username, role: 'STUDENT' }),
      `P9 Student ${username.slice(3)}`,
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
  const s2 = await student('p9.s2', sec('A'), '2');
  const s1 = await student('p9.s1', sec('A'), '1');
  const s3 = await student('p9.s3', sec('B'), '1');

  // Published timetable: Arun teaches Maths to X-A on Monday, Period 1.
  await ok('POST', `/timetable/years/${year.id}/draft`);
  await ok('POST', `/timetable/years/${year.id}/draft/changes`, {
    sectionId: sec('A'),
    operations: [
      {
        op: 'create',
        id: randomUUID(),
        day: 'MON',
        periodId: period,
        sectionId: sec('A'),
        subjectId: maths.id,
        teacherId: arun,
      },
    ],
  });
  await ok('POST', `/timetable/years/${year.id}/draft/publish`);

  // Exam with Maths for class X, opened.
  const exam = await ok('POST', '/admin/exams', {
    academicYearId: year.id,
    name: 'P9 Mid Term',
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

  // Behaviour configuration (Phase 4): categories and the five labels.
  const cat = async (name: string, order: number) =>
    (
      await ok('POST', '/admin/behaviour/categories', {
        name,
        description: null,
        displayOrder: order,
      })
    ).id;
  const discipline = await cat('P9 Discipline', 1);
  const participation = await cat('P9 Participation', 2);
  const old = await cat('P9 Retired', 3);
  await ok('PATCH', `/admin/behaviour/categories/${old}`, { status: 'INACTIVE' });
  await ok('PUT', '/admin/behaviour/rating-labels', {
    labels: ['Needs work', 'Below', 'Fair', 'Good', 'Excellent'].map((label, i) => ({
      rating: i + 1,
      label: `P9 ${label}`,
      description: null,
    })),
  });
  const achCat = async (name: string, order: number) =>
    (
      await ok('POST', '/admin/achievement-categories', {
        name,
        description: null,
        displayOrder: order,
      })
    ).id;
  const sports = await achCat('P9 Sports', 1);
  const academic = await achCat('P9 Academic', 2);
  const retired = await achCat('P9 Retired', 3);
  await ok('PATCH', `/admin/achievement-categories/${retired}`, { status: 'INACTIVE' });

  return {
    year: year.id,
    xA: sec('A'),
    xB: sec('B'),
    period,
    maths: maths.id,
    exam: exam.id,
    esMaths: subjects[0].id,
    cats: { discipline, participation, old },
    achCats: { sports, academic, retired },
    kumar,
    priya,
    arun,
    s1,
    s2,
    s3,
  };
}

const rate = (
  studentId: string,
  d: number | null,
  p: number | null,
  remark: string | null = null,
  s?: School,
) => ({
  studentId,
  ratings: [
    { categoryId: s!.cats.discipline, rating: d },
    { categoryId: s!.cats.participation, rating: p },
  ],
  remark,
});

describe.each<TestDriver>(['sqlite', 'postgres'])(
  'student portal, behaviour, achievements (%s)',
  (driver) => {
    let h: TestApp;
    let db: Kysely<Database>;
    let admin: Session;
    let s: School;

    beforeEach(async () => {
      const opened = await openTestDatabase(driver);
      db = opened.db;
      h = await buildTestApp({
        dataStore: opened.store,
        clock: new MutableClock('2026-09-21T03:30:00.000Z'),
      });
      admin = await adminSession(h);
      s = await setup(h, admin, db);
    }, 120_000);
    afterEach(async () => {
      await h.close();
    });

    it('portal: a student reads only their own profile, timetable, attendance, marks and results', async () => {
      const s1 = await sessionFor(h, 'p9.s1');
      const anon = { app: h.app, cookie: '' };
      // Profile: own record, current placement and history; nothing administrative.
      const profile = await call(s1, 'GET', '/portal/profile');
      expect(profile.status).toBe(200);
      expect(profile.data).toMatchObject({
        student: { id: s.s1, fullName: 'P9 Student s1', status: 'ACTIVE' },
        account: { username: 'p9.s1', status: 'ACTIVE' },
        currentYear: { label: 'P9-2026' },
        current: { className: 'P9-X', sectionName: 'A', rollNumber: '1' },
      });
      expect(profile.raw).not.toMatch(/password|hash|deletable|exitReason|userId/i);
      expect((await call(anon, 'GET', '/portal/profile')).status).toBe(401);
      // Staff cannot use the student-only endpoints.
      expect((await call(admin, 'GET', '/portal/profile')).status).toBe(403);
      // Another student's record through any route: refused, same as a missing id.
      const other = await call(s1, 'GET', `/admin/students/${s.s2}`);
      const missing = await call(s1, 'GET', `/admin/students/${randomUUID()}`);
      expect(other.status).toBe(403);
      expect(missing.status).toBe(403);
      expect(other.error.message).toBe(missing.error.message);
      for (const url of [
        `/timetable/students/${s.s2}`,
        `/attendance/students/${s.s2}?from=2026-09-01&to=2026-09-30`,
        `/results/exams/${s.exam}/students/${s.s2}`,
        `/behaviour/students/${s.s2}`,
      ]) {
        expect((await call(s1, 'GET', url)).status, url).toBe(403);
      }
      // Students cannot change academic records with crafted requests.
      expect(
        (await call(s1, 'PUT', `/admin/students/${s.s1}`, { fullName: 'Hacked' })).status,
      ).toBe(403);
      expect(
        (
          await call(s1, 'PUT', '/marks/sheet', {
            examSubjectId: s.esMaths,
            sectionId: s.xA,
            revision: null,
            marks: [],
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(s1, 'PUT', '/attendance/register', {
            date: MON,
            periodId: s.period,
            sectionId: s.xA,
            revision: null,
            marks: [],
          })
        ).status,
      ).toBe(403);

      // Timetable: the published timetable of their own section.
      const tt = await call(s1, 'GET', `/timetable/students/${s.s1}`);
      expect(tt.status).toBe(200);
      expect(tt.data.placement).toMatchObject({ className: 'P9-X', sectionName: 'A' });
      expect(tt.data.timetable.entries).toHaveLength(1);
      expect(tt.data.timetable.entries[0]).toMatchObject({ day: 'MON' });

      // Attendance: the register Arun takes appears in the student's own view.
      const arun = await sessionFor(h, 'p9.arun');
      const reg = await call(arun, 'PUT', '/attendance/register', {
        date: MON,
        periodId: s.period,
        sectionId: s.xA,
        revision: null,
        marks: [
          { studentId: s.s1, status: 'P' },
          { studentId: s.s2, status: 'A' },
        ],
      });
      expect(reg.status, reg.raw).toBe(200);
      const att = await call(s1, 'GET', '/attendance/me?from=2026-09-21&to=2026-09-21');
      expect(att.data.counts).toMatchObject({ P: 1, A: 0, percentage: 100 });

      // Marks/results: Phase 8B visibility — nothing until submitted, then own result only.
      const empty = await call(s1, 'GET', `/results/me/exams/${s.exam}`);
      expect(empty.data.subjects[0]).toMatchObject({ available: false });
      const draft = await call(admin, 'PUT', '/marks/sheet', {
        examSubjectId: s.esMaths,
        sectionId: s.xA,
        revision: null,
        marks: [
          { studentId: s.s1, theory: 80, internal: null, practical: null },
          { studentId: s.s2, theory: 60, internal: null, practical: null },
        ],
      });
      await call(admin, 'POST', '/marks/sheet/submit', {
        examSubjectId: s.esMaths,
        sectionId: s.xA,
        revision: draft.data.revision,
      });
      const result = await call(s1, 'GET', `/results/me/exams/${s.exam}`);
      expect(result.data.summary).toMatchObject({ total: 80, rank: 1, rankedOf: 2 });
      expect(result.raw).not.toContain('P9 Student s2');
    }, 60_000);

    it('behaviour: class teacher records own section, draft hidden, submit visible, correction with reason', async () => {
      const kumar = await sessionFor(h, 'p9.kumar');
      const priya = await sessionFor(h, 'p9.priya');
      const arun = await sessionFor(h, 'p9.arun');
      const s1 = await sessionFor(h, 'p9.s1');
      const key = { examId: s.exam, sectionId: s.xA };
      const url = `/behaviour/sheet?examId=${s.exam}&sectionId=${s.xA}`;

      // Options: the class teacher sees only their own section; labels and categories come from config.
      const options = await call(kumar, 'GET', '/behaviour/options');
      expect(options.data.sections.map((x: any) => x.sectionName)).toEqual(['A']);
      expect(options.data.exams.map((e: any) => e.name)).toEqual(['P9 Mid Term']);
      expect(options.data.setupProblems).toEqual([]);
      const sheet = await call(kumar, 'GET', url);
      expect(sheet.status).toBe(200);
      expect(sheet.data.categories.map((c: any) => c.name)).toEqual([
        'P9 Discipline',
        'P9 Participation',
      ]);
      expect(sheet.data.labels[4]).toEqual({ rating: 5, label: 'P9 Excellent' });
      expect(sheet.data.rows.map((r: any) => r.studentId)).toEqual([s.s1, s.s2]);
      expect(sheet.data.access).toMatchObject({
        canEdit: true,
        canSubmit: true,
        correction: false,
      });

      // Scope: another section, subject teachers and students are refused; ids do not leak.
      expect(
        (await call(kumar, 'GET', `/behaviour/sheet?examId=${s.exam}&sectionId=${s.xB}`)).status,
      ).toBe(403);
      expect(
        (
          await call(kumar, 'PUT', '/behaviour/sheet', {
            examId: s.exam,
            sectionId: s.xB,
            revision: null,
            rows: [rate(s.s3, 4, 4, null, s)],
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(priya, 'PUT', '/behaviour/sheet', {
            ...key,
            revision: null,
            rows: [rate(s.s1, 4, 4, null, s)],
          })
        ).status,
      ).toBe(403);
      expect((await call(arun, 'GET', url)).status).toBe(403);
      expect(
        (
          await call(arun, 'PUT', '/behaviour/sheet', {
            ...key,
            revision: null,
            rows: [rate(s.s1, 4, 4, null, s)],
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(s1, 'PUT', '/behaviour/sheet', {
            ...key,
            revision: null,
            rows: [rate(s.s1, 5, 5, null, s)],
          })
        ).status,
      ).toBe(403);
      expect((await call(s1, 'GET', url)).status).toBe(403);
      // A student of another section cannot be written through this sheet.
      const wrong = await call(kumar, 'PUT', '/behaviour/sheet', {
        ...key,
        revision: null,
        rows: [rate(s.s3, 4, 4, null, s)],
      });
      expect(wrong.status).toBe(409);
      expect(wrong.error.details[0].path).toBe('body.rows.0.studentId');
      // Invalid ratings and categories are refused.
      expect(
        (
          await call(kumar, 'PUT', '/behaviour/sheet', {
            ...key,
            revision: null,
            rows: [rate(s.s1, 6, 4, null, s)],
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call(kumar, 'PUT', '/behaviour/sheet', {
            ...key,
            revision: null,
            rows: [rate(s.s1, 0, 4, null, s)],
          })
        ).status,
      ).toBe(400);
      const inactive = await call(kumar, 'PUT', '/behaviour/sheet', {
        ...key,
        revision: null,
        rows: [{ studentId: s.s1, ratings: [{ categoryId: s.cats.old, rating: 3 }], remark: null }],
      });
      expect(inactive.status).toBe(409);

      // Draft: saved, invisible to the student.
      const saved = await call(kumar, 'PUT', '/behaviour/sheet', {
        ...key,
        revision: null,
        rows: [rate(s.s1, 4, 5, 'Helpful in class', s), rate(s.s2, 3, null, null, s)],
      });
      expect(saved.status, saved.raw).toBe(200);
      expect(saved.data).toMatchObject({
        status: 'DRAFT',
        revision: 1,
        counts: { complete: 1, total: 2 },
      });
      expect((await call(s1, 'GET', '/portal/behaviour')).data.assessments).toEqual([]);
      // Incomplete sheets cannot be submitted.
      const early = await call(kumar, 'POST', '/behaviour/sheet/submit', { ...key, revision: 1 });
      expect(early.status).toBe(409);
      expect(early.error.message).toMatch(/missing for 1 of 2/);
      // Stale revisions are refused.
      expect(
        (
          await call(kumar, 'PUT', '/behaviour/sheet', {
            ...key,
            revision: null,
            rows: [rate(s.s2, 3, 3, null, s)],
          })
        ).status,
      ).toBe(409);
      const done = await call(kumar, 'PUT', '/behaviour/sheet', {
        ...key,
        revision: 1,
        rows: [rate(s.s2, 3, 2, null, s)],
      });
      expect(done.data.counts).toEqual({ complete: 2, total: 2 });
      const submitted = await call(kumar, 'POST', '/behaviour/sheet/submit', {
        ...key,
        revision: done.data.revision,
      });
      expect(submitted.status, submitted.raw).toBe(200);
      expect(submitted.data).toMatchObject({
        status: 'SUBMITTED',
        submitted: { by: 'P9 Kumar' },
        access: { correction: true, canSubmit: false },
      });

      // Submitted: visible to the student, own only, with the configured labels.
      const mine = await call(s1, 'GET', '/portal/behaviour');
      expect(mine.data.assessments).toHaveLength(1);
      expect(mine.data.assessments[0]).toMatchObject({
        exam: { name: 'P9 Mid Term' },
        status: 'SUBMITTED',
        remark: 'Helpful in class',
        ratings: [
          { categoryName: 'P9 Discipline', rating: 4, label: 'P9 Good' },
          { categoryName: 'P9 Participation', rating: 5, label: 'P9 Excellent' },
        ],
      });
      expect(mine.raw).not.toContain(s.s2);

      // A later label change does not rewrite the finalised meaning.
      await call(admin, 'PUT', '/admin/behaviour/rating-labels', {
        labels: ['A', 'B', 'C', 'D', 'E'].map((label, i) => ({
          rating: i + 1,
          label: `New ${label}`,
          description: null,
        })),
      });
      expect(
        (await call(s1, 'GET', '/portal/behaviour')).data.assessments[0].ratings[0].label,
      ).toBe('P9 Good');

      // Corrections need a reason, keep every category rated, stay submitted and are audited.
      const noReason = await call(kumar, 'PUT', '/behaviour/sheet', {
        ...key,
        revision: submitted.data.revision,
        rows: [rate(s.s1, 2, 5, 'Helpful in class', s)],
      });
      expect(noReason.status).toBe(409);
      expect(noReason.error.details[0].path).toBe('body.reason');
      const blank = await call(kumar, 'PUT', '/behaviour/sheet', {
        ...key,
        revision: submitted.data.revision,
        rows: [rate(s.s1, null, 5, 'Helpful in class', s)],
        reason: 'Clearing a rating',
      });
      expect(blank.status).toBe(409);
      const corrected = await call(kumar, 'PUT', '/behaviour/sheet', {
        ...key,
        revision: submitted.data.revision,
        rows: [rate(s.s1, 2, 5, 'Talks during lessons', s)],
        reason: 'Wrong rating entered for roll 1',
      });
      expect(corrected.status, corrected.raw).toBe(200);
      expect(corrected.data.status).toBe('SUBMITTED');
      const after = await call(s1, 'GET', '/portal/behaviour');
      expect(after.data.assessments[0]).toMatchObject({ remark: 'Talks during lessons' });
      expect(after.data.assessments[0].ratings[0]).toMatchObject({ rating: 2, label: 'New B' });
      const audit = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('action', '=', 'behaviour.corrected')
        .executeTakeFirstOrThrow();
      expect(audit.reason).toBe('Wrong rating entered for roll 1');
      expect(JSON.parse(audit.after_json!)).toMatchObject({
        academicYear: 'P9-2026',
        exam: 'P9 Mid Term',
        student: 'P9 Student s1',
        changes: [{ category: 'P9 Discipline', from: '4 (New D)', to: '2 (New B)' }],
        remark: { from: 'Helpful in class', to: 'Talks during lessons' },
      });
      const history = await call(
        kumar,
        'GET',
        `/behaviour/sheet/history?examId=${s.exam}&sectionId=${s.xA}`,
      );
      expect(history.data.map((x: any) => x.action)).toContain('behaviour.submitted');
      // Administrators may record and correct any section; staff view of one student.
      const adminView = await call(
        admin,
        'GET',
        `/behaviour/sheet?examId=${s.exam}&sectionId=${s.xB}`,
      );
      expect(adminView.data.access.canEdit).toBe(true);
      const forStudent = await call(kumar, 'GET', `/behaviour/students/${s.s1}`);
      expect(forStudent.data.assessments[0].status).toBe('SUBMITTED');
      expect((await call(kumar, 'GET', `/behaviour/students/${s.s3}`)).status).toBe(403);
      // Closing the exam freezes behaviour too.
      await call(admin, 'PUT', `/admin/exams/${s.exam}/stage`, { stage: 'CLOSED' });
      const frozen = await call(kumar, 'PUT', '/behaviour/sheet', {
        ...key,
        revision: corrected.data.revision,
        rows: [rate(s.s1, 3, 5, null, s)],
        reason: 'After closing',
      });
      expect(frozen.status).toBe(409);
    }, 60_000);

    it('achievements: admin and own-section class teacher manage; students read own; archive and delete safeguards', async () => {
      const kumar = await sessionFor(h, 'p9.kumar');
      const arun = await sessionFor(h, 'p9.arun');
      const s1 = await sessionFor(h, 'p9.s1');
      const s2 = await sessionFor(h, 'p9.s2');
      const body = (studentId: string, extra: object = {}) => ({
        studentId,
        academicYearId: s.year,
        categoryId: s.achCats.sports,
        title: 'District athletics — 100 m',
        description: 'First place',
        achievedOn: '2026-08-15',
        ...extra,
      });

      // Admin: any student.
      const byAdmin = await call(admin, 'POST', '/achievements', body(s.s3));
      expect(byAdmin.status, byAdmin.raw).toBe(201);
      expect(byAdmin.data).toMatchObject({
        section: { sectionName: 'B' },
        category: { name: 'P9 Sports' },
        status: 'ACTIVE',
      });
      // Class teacher: own section only; other sections refused without revealing.
      const byCt = await call(
        kumar,
        'POST',
        '/achievements',
        body(s.s1, {
          categoryId: s.achCats.academic,
          title: 'Maths Olympiad',
          achievedOn: '2026-09-01',
        }),
      );
      expect(byCt.status, byCt.raw).toBe(201);
      const otherSection = await call(kumar, 'POST', '/achievements', body(s.s3));
      const unknown = await call(kumar, 'POST', '/achievements', body(randomUUID()));
      expect(otherSection.status).toBe(403);
      expect(unknown.status).toBe(403);
      expect(otherSection.error.message).toBe(unknown.error.message);
      // Subject teachers and students cannot manage.
      expect((await call(arun, 'POST', '/achievements', body(s.s1))).status).toBe(403);
      expect((await call(arun, 'GET', '/achievements')).status).toBe(403);
      expect((await call(s1, 'POST', '/achievements', body(s.s1))).status).toBe(403);
      expect((await call(s1, 'PUT', `/achievements/${byCt.data.id}`, body(s.s1))).status).toBe(403);
      expect((await call(s1, 'DELETE', `/achievements/${byCt.data.id}`)).status).toBe(403);
      // Validation: inactive or unknown category, date outside the year, missing title.
      expect(
        (await call(admin, 'POST', '/achievements', body(s.s1, { categoryId: s.achCats.retired })))
          .status,
      ).toBe(409);
      expect(
        (await call(admin, 'POST', '/achievements', body(s.s1, { categoryId: randomUUID() })))
          .status,
      ).toBe(409);
      const outside = await call(
        admin,
        'POST',
        '/achievements',
        body(s.s1, { achievedOn: '2027-06-01' }),
      );
      expect(outside.status).toBe(409);
      expect(outside.error.details[0].path).toBe('body.achievedOn');
      expect((await call(admin, 'POST', '/achievements', body(s.s1, { title: '' }))).status).toBe(
        400,
      );

      // Lists are scoped: the class teacher sees X-A only.
      const ctList = await call(kumar, 'GET', '/achievements');
      expect(ctList.data.items.map((a: any) => a.title)).toEqual(['Maths Olympiad']);
      expect(ctList.data.items[0].canManage).toBe(true);
      const adminList = await call(admin, 'GET', `/achievements?categoryId=${s.achCats.sports}`);
      expect(adminList.data.total).toBe(1);
      expect((await call(kumar, 'GET', `/achievements/${byAdmin.data.id}`)).status).toBe(403);

      // Students: own active achievements only.
      const mine = await call(s1, 'GET', '/portal/achievements');
      expect(mine.data.items.map((a: any) => a.title)).toEqual(['Maths Olympiad']);
      expect(mine.data.items[0].createdBy).toBeNull();
      expect((await call(s2, 'GET', '/portal/achievements')).data.items).toEqual([]);
      expect((await call(s2, 'GET', `/achievements/${byCt.data.id}`)).status).toBe(403);
      expect((await call(s2, 'GET', `/achievements/${randomUUID()}`)).status).toBe(403);
      expect((await call(admin, 'GET', '/portal/achievements')).status).toBe(403);

      // Edit (audited old → new), archive hides it, delete only after archiving and only by admins.
      const edited = await call(kumar, 'PUT', `/achievements/${byCt.data.id}`, {
        categoryId: s.achCats.academic,
        title: 'Maths Olympiad — state level',
        description: null,
        achievedOn: '2026-09-02',
      });
      expect(edited.data).toMatchObject({
        title: 'Maths Olympiad — state level',
        achievedOn: '2026-09-02',
      });
      const audit = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('action', '=', 'achievement.updated')
        .executeTakeFirstOrThrow();
      expect(JSON.parse(audit.before_json!)).toMatchObject({
        title: 'Maths Olympiad',
        achievedOn: '2026-09-01',
        student: 'P9 Student s1',
        academicYear: 'P9-2026',
      });
      expect(JSON.parse(audit.after_json!)).toMatchObject({
        title: 'Maths Olympiad — state level',
        description: null,
      });
      expect((await call(admin, 'DELETE', `/achievements/${byCt.data.id}`)).status).toBe(409);
      expect((await call(kumar, 'POST', `/achievements/${byCt.data.id}/archive`)).data.status).toBe(
        'ARCHIVED',
      );
      expect((await call(s1, 'GET', '/portal/achievements')).data.items).toEqual([]);
      expect(
        (
          await call(kumar, 'PUT', `/achievements/${byCt.data.id}`, {
            categoryId: s.achCats.academic,
            title: 'x',
            description: null,
            achievedOn: '2026-09-02',
          })
        ).status,
      ).toBe(409);
      expect((await call(kumar, 'DELETE', `/achievements/${byCt.data.id}`)).status).toBe(403);
      expect((await call(admin, 'DELETE', `/achievements/${byCt.data.id}`)).status).toBe(200);
      expect((await call(admin, 'GET', `/achievements/${byCt.data.id}`)).status).toBe(404);
      const actions = (
        await db
          .selectFrom('audit_logs')
          .select('action')
          .where('entity_type', '=', 'achievement')
          .execute()
      )
        .map((a) => a.action)
        .sort();
      expect(actions).toEqual([
        'achievement.archived',
        'achievement.created',
        'achievement.created',
        'achievement.deleted',
        'achievement.updated',
      ]);
    }, 60_000);
  },
);
