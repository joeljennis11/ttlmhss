/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
 * Phase 8B — Exams, marks and results. TEST DATA ONLY: every name is synthetic and lives in a
 * throwaway in-memory database. The school, the exam and its configuration are built through the
 * real APIs. The exam runs 14–18 September 2026; the clock is Monday 21 September, 09:00 IST.
 */
const NOW = '2026-06-01T00:00:00.000Z';
const EXAM_START = '2026-09-14';
const EXAM_END = '2026-09-18';

interface School {
  year: string;
  xA: string;
  xB: string;
  xiA: string;
  maths: string;
  science: string;
  english: string;
  drawing: string;
  scale: string;
  arun: string;
  priya: string;
  kumar: string;
  /** X-A by roll number; s4 in X-B; s5 left X-A before the exam; s6 joined after it. */
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
  s6: string;
  enrolment: Record<string, string>;
}

async function setupSchool(h: TestApp, admin: Session, db: Kysely<Database>): Promise<School> {
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await call(admin, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  };
  const year = await ok('POST', '/admin/academic-years', {
    label: 'MK-2026',
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
  const p1 = day.slots.find((x: any) => x.label === 'Period 1').id;

  const x = await ok('POST', '/admin/classes', { name: 'MK-X', displayOrder: 10 });
  await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
  const xc = await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'B' });
  const xi = await ok('POST', '/admin/classes', { name: 'MK-XI', displayOrder: 11 });
  const xic = await ok('POST', `/admin/classes/${xi.id}/sections`, { name: 'A' });
  const sectionId = (cls: any, name: string) => cls.sections.find((s: any) => s.name === name).id;

  const subject = (name: string, order: number) =>
    ok('POST', '/admin/subjects', { name, code: null, displayOrder: order });
  const maths = await subject('MK Maths', 1);
  const science = await subject('MK Science', 2);
  const english = await subject('MK English', 3);
  const drawing = await subject('MK Drawing', 4);
  const scale = await ok('POST', '/admin/grade-scales', {
    name: 'MK scale',
    bands: [
      { label: 'A+', minPercent: 90, remark: null },
      { label: 'A', minPercent: 80, remark: null },
      { label: 'B', minPercent: 60, remark: null },
      { label: 'C', minPercent: 35, remark: null },
      { label: 'D', minPercent: 0, remark: null },
    ],
  });

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
  const arun = await teacher('mk.arun', 'MK Arun', [maths.id]);
  const priya = await teacher('mk.priya', 'MK Priya', [science.id, english.id, drawing.id]);
  const kumar = await teacher('mk.kumar', 'MK Kumar', [english.id]);
  await assignClassTeacher(db, kumar, year.id, sectionId(xc, 'A'));

  const enrolment: Record<string, string> = {};
  const student = async (
    username: string,
    section: string,
    roll: string,
    started = '2026-05-15',
    ended: string | null = null,
  ) => {
    const id = await linkStudent(
      db,
      await seedAccount(h.deps, { username, role: 'STUDENT' }),
      `MK Student ${username.slice(3)}`,
    );
    const eid = randomUUID();
    await db
      .insertInto('enrolments')
      .values({
        id: eid,
        student_id: id,
        academic_year_id: year.id,
        section_id: section,
        roll_number: roll,
        status: ended ? 'TRANSFERRED' : 'ACTIVE',
        started_on: started,
        ended_on: ended,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute();
    enrolment[id] = eid;
    return id;
  };
  const xA = sectionId(xc, 'A');
  const xB = sectionId(xc, 'B');
  // Inserted out of order on purpose: sheets sort by roll number.
  const s3 = await student('mk.s3', xA, '3');
  const s1 = await student('mk.s1', xA, '1');
  const s2 = await student('mk.s2', xA, '2');
  const s4 = await student('mk.s4', xB, '1');
  const s5 = await student('mk.s5', xA, '4', '2026-05-15', '2026-07-31'); // left before the exam
  const s6 = await student('mk.s6', xA, '5', '2026-10-01'); // joined after the exam

  // Arun teaches Maths to X-B in the published timetable — that alone must grant no marks access.
  await ok('POST', `/timetable/years/${year.id}/draft`);
  await ok('POST', `/timetable/years/${year.id}/draft/changes`, {
    sectionId: xB,
    operations: [
      {
        op: 'create',
        id: randomUUID(),
        day: 'MON',
        periodId: p1,
        sectionId: xB,
        subjectId: maths.id,
        teacherId: arun,
      },
    ],
  });
  await ok('POST', `/timetable/years/${year.id}/draft/publish`);

  return {
    year: year.id,
    xA,
    xB,
    xiA: sectionId(xic, 'A'),
    maths: maths.id,
    science: science.id,
    english: english.id,
    drawing: drawing.id,
    scale: scale.id,
    arun,
    priya,
    kumar,
    s1,
    s2,
    s3,
    s4,
    s5,
    s6,
    enrolment,
  };
}

/** The Phase 4 configuration of the exam for class MK-X (all through the real API). */
async function setupExam(admin: Session, s: School, classId: string) {
  const exam = (
    await call(admin, 'POST', '/admin/exams', {
      academicYearId: s.year,
      name: 'MK Mid Term',
      startDate: EXAM_START,
      endDate: EXAM_END,
      weightagePercent: 0,
      gradeSchemeId: s.scale,
      rankScope: 'SECTION',
      displayOrder: 1,
      description: 'Synthetic test exam',
    })
  ).data;
  const subjects = await call(admin, 'PUT', `/admin/exams/${exam.id}/classes/${classId}/subjects`, {
    subjects: [
      { subjectId: s.maths, theoryMax: 100, passMarks: 35 },
      { subjectId: s.science, theoryMax: 80, practicalMax: 20, passMarks: 35 },
      { subjectId: s.english, theoryMax: 50, passMarks: 18, normalizedMax: 100 },
      { subjectId: s.drawing, theoryMax: 50, passMarks: 0, includeInResult: false },
    ],
  });
  expect(subjects.status).toBe(200);
  const es = (subjectId: string) => subjects.data.find((x: any) => x.subjectId === subjectId).id;
  return {
    exam: exam.id,
    es: {
      maths: es(s.maths),
      science: es(s.science),
      english: es(s.english),
      drawing: es(s.drawing),
    },
  };
}

const sheetUrl = (examSubjectId: string, sectionId: string) =>
  `/marks/sheet?examSubjectId=${examSubjectId}&sectionId=${sectionId}`;
const save = (
  who: Session,
  examSubjectId: string,
  sectionId: string,
  revision: number | null,
  marks: {
    studentId: string;
    theory?: number | null;
    internal?: number | null;
    practical?: number | null;
  }[],
) =>
  call(who, 'PUT', '/marks/sheet', {
    examSubjectId,
    sectionId,
    revision,
    marks: marks.map((m) => ({
      studentId: m.studentId,
      theory: m.theory ?? null,
      internal: m.internal ?? null,
      practical: m.practical ?? null,
    })),
  });
const submit = (who: Session, examSubjectId: string, sectionId: string, revision: number) =>
  call(who, 'POST', '/marks/sheet/submit', { examSubjectId, sectionId, revision });
const assign = (who: Session, examSubjectId: string, sectionId: string, teacherId: string | null) =>
  call(who, 'PUT', `/admin/exam-subjects/${examSubjectId}/sections/${sectionId}/teacher`, {
    teacherId,
  });

/** Enter and submit a whole sheet as the given user (theory only unless given). */
async function enterAndSubmit(
  who: Session,
  examSubjectId: string,
  sectionId: string,
  marks: Parameters<typeof save>[4],
  between?: () => void,
) {
  const current = await call(who, 'GET', sheetUrl(examSubjectId, sectionId));
  const saved = await save(who, examSubjectId, sectionId, current.data.revision, marks);
  expect(saved.status, saved.raw).toBe(200);
  between?.();
  const done = await submit(who, examSubjectId, sectionId, saved.data.revision);
  expect(done.status, done.raw).toBe(200);
  return done.data;
}

describe.each<TestDriver>(['sqlite', 'postgres'])('exams, marks and results (%s)', (driver) => {
  let h: TestApp;
  let db: Kysely<Database>;
  let clock: MutableClock;
  let admin: Session;
  let s: School;
  let classX: string;

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    db = opened.db;
    clock = new MutableClock('2026-09-21T03:30:00.000Z'); // Monday 09:00 in India
    h = await buildTestApp({ dataStore: opened.store, clock });
    admin = await adminSession(h);
    s = await setupSchool(h, admin, db);
    classX = (
      await db
        .selectFrom('sections')
        .select('class_id')
        .where('id', '=', s.xA)
        .executeTakeFirstOrThrow()
    ).class_id;
  }, 120_000);
  afterEach(async () => {
    await h.close();
  });

  it('A–I, AP: an administrator creates, configures and opens an exam and authorises teachers', async () => {
    const { exam, es } = await setupExam(admin, s, classX);
    // A/B: created as a draft; edited.
    const view = await call(admin, 'GET', `/admin/exams/${exam}`);
    expect(view.data).toMatchObject({
      stage: 'DRAFT',
      description: 'Synthetic test exam',
      subjectCount: 4,
    });
    const edited = await call(admin, 'PATCH', `/admin/exams/${exam}`, {
      name: 'MK Mid Term 1',
      description: 'Edited note',
    });
    expect(edited.data).toMatchObject({
      name: 'MK Mid Term 1',
      description: 'Edited note',
      stage: 'DRAFT',
    });

    // C–G: per-subject maximums (not 100 everywhere), pass marks, components, normalisation.
    const subjects = (await call(admin, 'GET', `/admin/exams/${exam}/classes/${classX}/subjects`))
      .data;
    const bySubject = new Map(subjects.map((x: any) => [x.subjectId, x]));
    expect(bySubject.get(s.science)).toMatchObject({
      theoryMax: 80,
      practicalMax: 20,
      totalMax: 100,
      passMarks: 35,
    });
    expect(bySubject.get(s.english)).toMatchObject({
      theoryMax: 50,
      totalMax: 50,
      normalizedMax: 100,
      passMarks: 18,
    });
    expect(bySubject.get(s.drawing)).toMatchObject({
      includeInResult: false,
      hasMarks: false,
      locked: false,
    });

    // AP: an exam date on a whole-school holiday is only a warning; the calendar is untouched.
    expect(
      (
        await call(admin, 'POST', `/admin/academic-years/${s.year}/calendar`, {
          date: EXAM_START,
          status: 'HOLIDAY',
          scope: 'SCHOOL',
          classIds: [],
          sectionIds: [],
          reason: 'MK test holiday',
        })
      ).status,
    ).toBe(201);
    const calendarBefore = await db.selectFrom('calendar_entries').selectAll().execute();
    let matrix = await call(admin, 'GET', `/admin/exams/${exam}/mark-sheets`);
    expect(matrix.status).toBe(200);
    expect(matrix.data.calendarNotes).toEqual([expect.stringContaining(EXAM_START)]);
    expect(matrix.data.rows).toHaveLength(8); // 4 subjects × sections A and B
    expect(matrix.data.counts).toEqual({ sheets: 8, submitted: 0, withoutTeacher: 8 });
    expect(matrix.data.teachersBySubject[s.maths].map((t: any) => t.id)).toEqual([s.arun]);
    expect(await db.selectFrom('calendar_entries').selectAll().execute()).toEqual(calendarBefore);

    // H: authorise Arun for Maths in X-A (explicit, per exam subject + section).
    matrix = await assign(admin, es.maths, s.xA, s.arun);
    expect(matrix.status).toBe(200);
    const row = matrix.data.rows.find(
      (r: any) => r.examSubjectId === es.maths && r.sectionId === s.xA,
    );
    expect(row).toMatchObject({ teacher: { id: s.arun }, status: 'DRAFT', entered: 0 });
    // I: no duplicate authorisation; only a teacher of the subject; never a section of another class.
    const dup = await assign(admin, es.maths, s.xA, s.arun);
    expect(dup.status).toBe(409);
    expect(dup.error.details[0].message).toMatch(/already authorised/);
    const wrongSubject = await assign(admin, es.maths, s.xB, s.priya);
    expect(wrongSubject.status).toBe(409);
    expect(wrongSubject.error.details[0].message).toMatch(/does not teach MK Maths/);
    expect((await assign(admin, es.maths, s.xiA, s.arun)).status).toBe(404);
    expect(await db.selectFrom('mark_sheets').selectAll().execute()).toHaveLength(1);

    // Lifecycle: draft exams take no marks; opening needs subjects; DRAFT → OPEN → CLOSED → OPEN.
    const arun = await sessionFor(h, 'mk.arun');
    const early = await save(arun, es.maths, s.xA, 1, [{ studentId: s.s1, theory: 50 }]);
    expect(early.status).toBe(409);
    expect(early.error.message).toMatch(/not open for marks/);
    const empty = await call(admin, 'POST', '/admin/exams', {
      academicYearId: s.year,
      name: 'MK Empty',
      weightagePercent: 0,
      displayOrder: 2,
    });
    expect(
      (await call(admin, 'PUT', `/admin/exams/${empty.data.id}/stage`, { stage: 'OPEN' })).status,
    ).toBe(409);
    const opened = await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
    expect(opened.data.exam.stage).toBe('OPEN');
    expect((await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' })).status).toBe(
      409,
    );

    // Exam management is administrator-only; signed-out callers get 401.
    expect((await call(arun, 'GET', `/admin/exams/${exam}/mark-sheets`)).status).toBe(403);
    expect(
      (await call(arun, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'CLOSED' })).status,
    ).toBe(403);
    expect((await assign(arun, es.maths, s.xB, s.arun)).status).toBe(403);
    const anon = { app: h.app, cookie: '' };
    expect((await call(anon, 'GET', `/admin/exams/${exam}/mark-sheets`)).status).toBe(401);
    expect((await call(anon, 'GET', '/marks')).status).toBe(401);
    expect((await call(anon, 'GET', '/results/me')).status).toBe(401);

    const audit = await db
      .selectFrom('audit_logs')
      .select(['action'])
      .where('action', 'in', ['exam.stage_changed', 'marks.teacher_assigned'])
      .execute();
    expect(audit.map((a) => a.action).sort()).toEqual([
      'exam.stage_changed',
      'marks.teacher_assigned',
    ]);
  }, 60_000);

  it('J, K, AL, BR-SEC-01/02: teachers reach only sheets they are explicitly authorised for', async () => {
    const { exam, es } = await setupExam(admin, s, classX);
    await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
    await assign(admin, es.maths, s.xA, s.arun);
    await assign(admin, es.science, s.xA, s.priya);
    const arun = await sessionFor(h, 'mk.arun');
    const kumar = await sessionFor(h, 'mk.kumar');
    const student = await sessionFor(h, 'mk.s1');

    // J: Arun's Marks page lists only Maths X-A.
    const home = await call(arun, 'GET', '/marks');
    expect(home.data.exams).toHaveLength(1);
    expect(
      home.data.exams[0].sheets.map((x: any) => [x.subjectName, x.sectionName, x.role]),
    ).toEqual([['MK Maths', 'A', 'ENTRY_TEACHER']]);
    // K / BR-SEC-02: his timetabled Maths lesson in X-B gives no access; the refusal is the same
    // as for a sheet that does not exist (nothing is revealed).
    const xb = await call(arun, 'GET', sheetUrl(es.maths, s.xB));
    const none = await call(arun, 'GET', sheetUrl(randomUUID(), s.xB));
    expect(xb.status).toBe(403);
    expect(none.status).toBe(403);
    expect(xb.error.message).toBe(none.error.message);
    expect((await save(arun, es.maths, s.xB, null, [{ studentId: s.s4, theory: 10 }])).status).toBe(
      403,
    );
    // Tampering with the exam subject in the request does not widen access.
    expect(
      (await save(arun, es.science, s.xA, null, [{ studentId: s.s1, theory: 10 }])).status,
    ).toBe(403);
    // AL: a student of another section cannot be written through an authorised sheet.
    const other = await save(arun, es.maths, s.xA, null, [{ studentId: s.s4, theory: 10 }]);
    expect(other.status).toBe(409);
    expect(other.error.details[0].path).toBe('body.marks.0.studentId');

    // The class teacher sees every sheet of his section (view only) but enters none of them.
    const ctHome = await call(kumar, 'GET', '/marks');
    expect(
      ctHome.data.exams[0].sheets.every(
        (x: any) => x.role === 'CLASS_TEACHER' && x.sectionName === 'A',
      ),
    ).toBe(true);
    const ctView = await call(kumar, 'GET', sheetUrl(es.english, s.xA));
    expect(ctView.status).toBe(200);
    expect(ctView.data.access).toMatchObject({ canEdit: false, canSubmit: false });
    expect(
      (await save(kumar, es.english, s.xA, null, [{ studentId: s.s1, theory: 10 }])).status,
    ).toBe(403);
    expect((await call(kumar, 'GET', sheetUrl(es.english, s.xB))).status).toBe(403);
    // Students never open mark sheets.
    expect((await call(student, 'GET', sheetUrl(es.maths, s.xA))).status).toBe(403);
    expect((await call(student, 'GET', '/marks')).data.exams).toEqual([]);

    // Teacher → Subject is still required: removing Science from Priya removes her access.
    const priya = await sessionFor(h, 'mk.priya');
    expect((await call(priya, 'GET', sheetUrl(es.science, s.xA))).status).toBe(200);
    expect(
      (await call(admin, 'DELETE', `/admin/teachers/${s.priya}/subjects/${s.science}`)).status,
    ).toBe(200);
    expect((await call(priya, 'GET', sheetUrl(es.science, s.xA))).status).toBe(403);
    const matrix = await call(admin, 'GET', `/admin/exams/${exam}/mark-sheets`);
    expect(
      matrix.data.rows.find((r: any) => r.examSubjectId === es.science && r.sectionId === s.xA)
        .teacherProblem,
    ).toMatch(/no longer teaches/);
  }, 60_000);

  it('L–X: roster, draft, blanks and zero, limits, submit, lock and audit', async () => {
    const { exam, es } = await setupExam(admin, s, classX);
    await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
    await assign(admin, es.maths, s.xA, s.arun);
    await assign(admin, es.science, s.xA, s.priya);
    const arun = await sessionFor(h, 'mk.arun');
    const priya = await sessionFor(h, 'mk.priya');

    // L: the roster is the section on the exam's date — roll order; left/joined students excluded.
    const first = await call(arun, 'GET', sheetUrl(es.maths, s.xA));
    expect(first.status).toBe(200);
    expect(first.data.rows.map((r: any) => r.studentId)).toEqual([s.s1, s.s2, s.s3]);
    expect(first.data).toMatchObject({
      status: 'DRAFT',
      revision: 1,
      counts: { entered: 0, total: 3 },
    });
    expect(first.data.structure).toMatchObject({
      totalMax: 100,
      passMarks: 35,
      components: [{ key: 'theory', max: 100 }],
    });

    // M/N/O: draft save — 0 is a mark, blank stays "-".
    const saved = await save(arun, es.maths, s.xA, 1, [
      { studentId: s.s1, theory: 0 },
      { studentId: s.s2, theory: null },
    ]);
    expect(saved.status).toBe(200);
    const row = (id: string) => saved.data.rows.find((r: any) => r.studentId === id);
    expect(row(s.s1)).toMatchObject({
      marks: { theory: 0 },
      complete: true,
      total: 0,
      result: 'FAIL',
      grade: 'D',
    });
    expect(row(s.s2)).toMatchObject({
      marks: { theory: null },
      complete: false,
      total: null,
      result: null,
    });
    expect(saved.data.counts).toEqual({ entered: 1, total: 3 });
    expect(saved.data.revision).toBe(2);
    const stored = await db.selectFrom('mark_entries').selectAll().execute();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ theory_cm: 0, total_cm: null, grade: null });

    // P/Q: above the maximum, negative, a component the subject does not have.
    const tooHigh = await save(arun, es.maths, s.xA, 2, [{ studentId: s.s2, theory: 100.5 }]);
    expect(tooHigh.status).toBe(409);
    expect(tooHigh.error.details[0]).toMatchObject({
      path: 'body.marks.0.theory',
      message: expect.stringMatching(/cannot be more than 100/),
    });
    expect((await save(arun, es.maths, s.xA, 2, [{ studentId: s.s2, theory: -1 }])).status).toBe(
      400,
    );
    expect((await save(arun, es.maths, s.xA, 2, [{ studentId: s.s2, internal: 5 }])).status).toBe(
      409,
    );
    const sciTooHigh = await save(priya, es.science, s.xA, null, [
      { studentId: s.s1, theory: 70, practical: 21 },
    ]);
    expect(sciTooHigh.error.details[0].path).toBe('body.marks.0.practical');

    // S: an incomplete sheet cannot be submitted, and nothing becomes 0.
    const incomplete = await submit(arun, es.maths, s.xA, 2);
    expect(incomplete.status).toBe(409);
    expect(incomplete.error.message).toMatch(/missing for 2 of 3 students/);
    expect((await call(arun, 'GET', sheetUrl(es.maths, s.xA))).data.status).toBe('DRAFT');

    // R: complete and submit; results are calculated and stored with the settings used.
    const full = await save(arun, es.maths, s.xA, 2, [
      { studentId: s.s2, theory: 45.5 },
      { studentId: s.s3, theory: 100 },
    ]);
    expect(full.data.counts).toEqual({ entered: 3, total: 3 });
    const done = await submit(arun, es.maths, s.xA, full.data.revision);
    expect(done.status).toBe(200);
    expect(done.data).toMatchObject({
      status: 'SUBMITTED',
      submitted: { by: 'MK Arun' },
      access: { canEdit: false, canUnlock: false },
    });
    expect(done.data.rows.map((r: any) => [r.total, r.grade, r.result])).toEqual([
      [0, 'D', 'FAIL'],
      [45.5, 'C', 'PASS'],
      [100, 'A+', 'PASS'],
    ]);
    const sheet = await db
      .selectFrom('mark_sheets')
      .selectAll()
      .where('exam_subject_id', '=', es.maths)
      .executeTakeFirstOrThrow();
    expect(JSON.parse(sheet.calculation!)).toMatchObject({
      theoryMax: 100,
      passMarks: 35,
      gradeScale: { name: 'MK scale' },
    });
    expect(sheet.submitted_at).not.toBeNull();

    // T/U: locked for the teacher (backend), and no ordinary teacher can unlock it.
    const locked = await save(arun, es.maths, s.xA, done.data.revision, [
      { studentId: s.s1, theory: 10 },
    ]);
    expect(locked.status).toBe(409);
    expect(locked.error.message).toMatch(/submitted and locked/);
    const unlockBody = {
      examSubjectId: es.maths,
      sectionId: s.xA,
      revision: done.data.revision,
      reason: 'Wrong mark for roll 1',
    };
    expect((await call(arun, 'POST', '/marks/sheet/unlock', unlockBody)).status).toBe(403);
    expect((await call(priya, 'POST', '/marks/sheet/unlock', unlockBody)).status).toBe(403);

    // X: every change audited with where, who, old and new values.
    const entered = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'marks.entered')
      .execute();
    expect(entered).toHaveLength(3);
    const s1Audit = entered.map((e) => JSON.parse(e.after_json!)).find((a) => a.studentId === s.s1);
    expect(s1Audit).toMatchObject({
      academicYear: 'MK-2026',
      exam: 'MK Mid Term',
      subject: 'MK Maths',
      classSection: 'MK-X A',
      student: 'MK Student s1',
      changes: [{ component: 'Theory', from: '-', to: '0' }],
    });
    const submittedAudit = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'marks.submitted')
      .execute();
    expect(submittedAudit).toHaveLength(1);
  }, 60_000);

  it('V, W: unlock needs authority and a reason; corrections are audited and need resubmission', async () => {
    const { exam, es } = await setupExam(admin, s, classX);
    await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
    await assign(admin, es.maths, s.xA, s.arun);
    const arun = await sessionFor(h, 'mk.arun');
    const kumar = await sessionFor(h, 'mk.kumar');
    const student = await sessionFor(h, 'mk.s1');
    const tick = () => clock.advance(60_000);
    tick();
    const done = await enterAndSubmit(
      arun,
      es.maths,
      s.xA,
      [
        { studentId: s.s1, theory: 40 },
        { studentId: s.s2, theory: 50 },
        { studentId: s.s3, theory: 60 },
      ],
      tick,
    );
    tick();
    const body = { examSubjectId: es.maths, sectionId: s.xA, revision: done.revision };
    expect((await call(kumar, 'POST', '/marks/sheet/unlock', { ...body, reason: '' })).status).toBe(
      400,
    );
    expect(
      (await call(kumar, 'POST', '/marks/sheet/unlock', { ...body, reason: 'typo' })).status,
    ).toBe(400);
    // The class teacher of X-A (marks.edit) unlocks with a reason.
    const unlocked = await call(kumar, 'POST', '/marks/sheet/unlock', {
      ...body,
      reason: 'Wrong mark for roll 1',
    });
    expect(unlocked.status).toBe(200);
    tick();
    expect(unlocked.data).toMatchObject({
      status: 'UNLOCKED',
      unlocked: { by: 'MK Kumar', reason: 'Wrong mark for roll 1' },
    });
    // During correction the subject is not shown to students.
    const during = await call(student, 'GET', `/results/me/exams/${exam}`);
    expect(during.data.subjects.find((x: any) => x.subjectId === s.maths).available).toBe(false);

    // The authorised teacher corrects and resubmits.
    const fixed = await save(arun, es.maths, s.xA, unlocked.data.revision, [
      { studentId: s.s1, theory: 45 },
    ]);
    expect(fixed.status).toBe(200);
    tick();
    const again = await submit(arun, es.maths, s.xA, fixed.data.revision);
    expect(again.data.status).toBe('SUBMITTED');
    const after = await call(student, 'GET', `/results/me/exams/${exam}`);
    expect(after.data.subjects.find((x: any) => x.subjectId === s.maths)).toMatchObject({
      available: true,
      obtained: 45,
    });

    // W: the lifecycle is in the audit trail and readable as history.
    const corrected = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'marks.corrected')
      .executeTakeFirstOrThrow();
    expect(corrected.reason).toBe('Wrong mark for roll 1');
    expect(JSON.parse(corrected.after_json!).changes).toEqual([
      { component: 'Theory', from: '40', to: '45' },
    ]);
    const unlockAudit = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'marks.unlocked')
      .executeTakeFirstOrThrow();
    expect(unlockAudit.reason).toBe('Wrong mark for roll 1');
    const history = await call(
      kumar,
      'GET',
      `/marks/sheet/history?examSubjectId=${es.maths}&sectionId=${s.xA}`,
    );
    expect(history.data.map((x: any) => x.action)).toEqual([
      'marks.resubmitted',
      'marks.corrected',
      'marks.unlocked',
      'marks.submitted',
      'marks.entered',
      'marks.entered',
      'marks.entered',
      'marks.teacher_assigned',
    ]);
    expect(history.data[2]).toMatchObject({ actor: 'MK Kumar', reason: 'Wrong mark for roll 1' });
    expect(
      (
        await call(
          student,
          'GET',
          `/marks/sheet/history?examSubjectId=${es.maths}&sectionId=${s.xA}`,
        )
      ).status,
    ).toBe(403);

    // A class teacher cannot unlock another class; an administrator can unlock anything.
    await assign(admin, es.maths, s.xB, s.arun);
    const xb = await enterAndSubmit(admin, es.maths, s.xB, [{ studentId: s.s4, theory: 70 }]);
    const xbBody = {
      examSubjectId: es.maths,
      sectionId: s.xB,
      revision: xb.revision,
      reason: 'Checking access',
    };
    expect((await call(kumar, 'POST', '/marks/sheet/unlock', xbBody)).status).toBe(403);
    expect((await call(admin, 'POST', '/marks/sheet/unlock', xbBody)).status).toBe(200);
  }, 60_000);

  it('Y–AJ, AK: visibility, complete results, totals, percentage and class/section rank', async () => {
    const { exam, es } = await setupExam(admin, s, classX);
    await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
    const s1 = await sessionFor(h, 'mk.s1');
    const kumar = await sessionFor(h, 'mk.kumar');
    const arun = await sessionFor(h, 'mk.arun');
    await assign(admin, es.maths, s.xA, s.arun);

    // Maths submitted; Science only a draft.
    await enterAndSubmit(admin, es.maths, s.xA, [
      { studentId: s.s1, theory: 84 },
      { studentId: s.s2, theory: 90 },
      { studentId: s.s3, theory: 84 },
    ]);
    const draft = await save(admin, es.science, s.xA, null, [
      { studentId: s.s1, theory: 54, practical: 17.75 },
    ]);
    expect(draft.status).toBe(200);
    // AC/AD/AE: Maths visible, the Science draft is invisible, no complete result yet.
    let mine = await call(s1, 'GET', `/results/me/exams/${exam}`);
    expect(mine.status).toBe(200);
    const subject = (view: any, id: string) => view.subjects.find((x: any) => x.subjectId === id);
    expect(subject(mine.data, s.maths)).toMatchObject({
      available: true,
      obtained: 84,
      grade: 'A',
      result: 'PASS',
    });
    expect(subject(mine.data, s.science)).toMatchObject({
      available: false,
      obtained: null,
      components: null,
    });
    expect(mine.raw).not.toContain('17.75');
    expect(mine.data).toMatchObject({
      complete: false,
      summary: null,
      availableCount: 1,
      requiredCount: 3,
    });

    // Finish Science and English (normalised 50 → 100) and Drawing (does not count).
    await enterAndSubmit(admin, es.science, s.xA, [
      { studentId: s.s1, theory: 54, practical: 18 },
      { studentId: s.s2, theory: 60, practical: 20 },
      { studentId: s.s3, theory: 52, practical: 20 },
    ]);
    // AI: before English is submitted nobody has a complete result, so nobody is ranked.
    const partial = await call(kumar, 'GET', `/results/exams/${exam}/sections/${s.xA}`);
    expect(partial.data.rankedOf).toBe(0);
    await enterAndSubmit(admin, es.english, s.xA, [
      { studentId: s.s1, theory: 45.5 },
      { studentId: s.s2, theory: 15 },
      { studentId: s.s3, theory: 45.5 },
    ]);
    await enterAndSubmit(admin, es.drawing, s.xA, [
      { studentId: s.s1, theory: 30 },
      { studentId: s.s2, theory: 0 },
      { studentId: s.s3, theory: 50 },
    ]);
    // X-B has its own population.
    for (const [key, mark] of [
      ['maths', 100],
      ['science', 100],
      ['english', 50],
      ['drawing', 50],
    ] as const) {
      await enterAndSubmit(admin, es[key], s.xB, [
        key === 'science'
          ? { studentId: s.s4, theory: 80, practical: 20 }
          : { studentId: s.s4, theory: mark },
      ]);
    }

    mine = await call(s1, 'GET', `/results/me/exams/${exam}`);
    // Y/Z: English 45.5/50 normalised to 91/100; the raw mark is kept.
    expect(subject(mine.data, s.english)).toMatchObject({
      obtained: 45.5,
      totalMax: 50,
      normalized: 91,
      normalizedMax: 100,
      final: 91,
      finalMax: 100,
      percent: 91,
      grade: 'A+',
    });
    const english = await db
      .selectFrom('mark_entries')
      .selectAll()
      .where('student_id', '=', s.s1)
      .where('normalized_cm', 'is not', null)
      .executeTakeFirstOrThrow();
    expect(english).toMatchObject({ theory_cm: 4550, total_cm: 4550, normalized_cm: 9100 });
    // Components shown separately and added once: Science 54 + 18 = 72/100.
    expect(subject(mine.data, s.science)).toMatchObject({
      obtained: 72,
      components: [
        { key: 'theory', max: 80, obtained: 54 },
        { key: 'practical', max: 20, obtained: 18 },
      ],
    });
    // AF/AG: total = 84 + 72 + 91 = 247 of 300 (Drawing does not count) → 82.33 %.
    expect(subject(mine.data, s.drawing)).toMatchObject({ countsInResult: false, available: true });
    expect(mine.data).toMatchObject({
      complete: true,
      student: { fullName: 'MK Student s1', rollNumber: '1' },
      section: { className: 'MK-X', sectionName: 'A' },
      summary: {
        total: 247,
        max: 300,
        percentage: 82.33,
        result: 'PASS',
        rank: 1,
        rankedOf: 3,
        rankScope: 'SECTION',
      },
    });

    // AB: s2 fails English (15 < 18) → overall FAIL; AH: rank within X-A only (competition rank).
    const cls = await call(kumar, 'GET', `/results/exams/${exam}/sections/${s.xA}`);
    expect(cls.status).toBe(200);
    expect(
      cls.data.students.map((x: any) => [
        x.fullName,
        x.summary?.total,
        x.summary?.result,
        x.summary?.rank,
      ]),
    ).toEqual([
      ['MK Student s1', 247, 'PASS', 1],
      ['MK Student s2', 200, 'FAIL', 3],
      ['MK Student s3', 247, 'PASS', 1],
    ]);
    expect(cls.data.rankedOf).toBe(3);
    const xb = await call(admin, 'GET', `/results/exams/${exam}/students/${s.s4}`);
    expect(xb.data.summary).toMatchObject({ total: 300, rank: 1, rankedOf: 1 });

    // AI: a student placed in X-A afterwards (no marks) is listed but not complete or ranked.
    const late = await linkStudent(
      db,
      await seedAccount(h.deps, { username: 'mk.s7', role: 'STUDENT' }),
      'MK Student s7',
    );
    await db
      .insertInto('enrolments')
      .values({
        id: randomUUID(),
        student_id: late,
        academic_year_id: s.year,
        section_id: s.xA,
        roll_number: '6',
        status: 'ACTIVE',
        started_on: '2026-09-01',
        ended_on: null,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute();
    const withLate = await call(admin, 'GET', `/results/exams/${exam}/sections/${s.xA}`);
    expect(withLate.data.students.find((x: any) => x.studentId === late)).toMatchObject({
      complete: false,
      summary: null,
    });
    expect(withLate.data.rankedOf).toBe(3);

    // AJ: moving s1 to X-B afterwards does not move the result.
    const moved = await call(admin, 'POST', `/admin/students/${s.s1}/transfer`, {
      targetSectionId: s.xB,
      rollNumber: '9',
      effectiveDate: '2026-09-21',
    });
    expect(moved.status, moved.raw).toBe(200);
    mine = await call(s1, 'GET', `/results/me/exams/${exam}`);
    expect(mine.data.section.sectionName).toBe('A');
    expect(mine.data.summary).toMatchObject({ total: 247, rank: 1, rankedOf: 3 });

    // AK/AL: no one else's result, no class results for students or subject teachers.
    const forbidden = await call(s1, 'GET', `/results/exams/${exam}/students/${s.s2}`);
    const missing = await call(s1, 'GET', `/results/exams/${exam}/students/${randomUUID()}`);
    expect(forbidden.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(forbidden.error.message).toBe(missing.error.message);
    expect((await call(s1, 'GET', `/results/exams/${exam}/sections/${s.xA}`)).status).toBe(403);
    expect((await call(arun, 'GET', `/results/exams/${exam}/sections/${s.xA}`)).status).toBe(403);
    expect((await call(kumar, 'GET', `/results/exams/${exam}/sections/${s.xB}`)).status).toBe(403);
    expect((await call(kumar, 'GET', `/results/exams/${exam}/students/${s.s4}`)).status).toBe(403);
    // The student's exam list shows open exams of their years only.
    const list = await call(s1, 'GET', '/results/me');
    expect(list.data.exams.map((e: any) => e.name)).toEqual(['MK Mid Term']);
    expect(list.data.sections).toEqual([]);
  }, 120_000);

  it('AM: a deactivated teacher’s submitted marks stay; an administrator carries on', async () => {
    const { exam, es } = await setupExam(admin, s, classX);
    await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
    await assign(admin, es.maths, s.xA, s.arun);
    await assign(admin, es.english, s.xA, s.priya);
    const arun = await sessionFor(h, 'mk.arun');
    const priya = await sessionFor(h, 'mk.priya');
    await enterAndSubmit(arun, es.maths, s.xA, [
      { studentId: s.s1, theory: 40 },
      { studentId: s.s2, theory: 50 },
      { studentId: s.s3, theory: 60 },
    ]);
    const draft = await save(priya, es.english, s.xA, 1, [{ studentId: s.s1, theory: 20 }]);
    expect(draft.status).toBe(200);
    for (const id of [s.arun, s.priya]) {
      expect(
        (await call(admin, 'POST', `/admin/teachers/${id}/status`, { status: 'INACTIVE' })).status,
      ).toBe(200);
    }
    const maths = await call(admin, 'GET', sheetUrl(es.maths, s.xA));
    expect(maths.data).toMatchObject({ status: 'SUBMITTED', submitted: { by: 'MK Arun' } });
    expect(maths.data.rows.map((r: any) => r.total)).toEqual([40, 50, 60]);
    const matrix = await call(admin, 'GET', `/admin/exams/${exam}/mark-sheets`);
    expect(
      matrix.data.rows.find((r: any) => r.examSubjectId === es.english && r.sectionId === s.xA)
        .teacherProblem,
    ).toMatch(/inactive/);
    // The administrator finishes the inactive teacher's draft.
    const english = await enterAndSubmit(admin, es.english, s.xA, [
      { studentId: s.s2, theory: 30 },
      { studentId: s.s3, theory: 40 },
    ]);
    expect(english.rows.map((r: any) => r.total)).toEqual([20, 30, 40]);
    // An inactive teacher cannot be newly authorised.
    expect((await assign(admin, es.science, s.xA, s.priya)).status).toBe(409);
  }, 60_000);

  it('AN: a save or submit based on an older revision is refused', async () => {
    const { exam, es } = await setupExam(admin, s, classX);
    await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
    await assign(admin, es.maths, s.xA, s.arun);
    const arun = await sessionFor(h, 'mk.arun');
    const opened = await call(arun, 'GET', sheetUrl(es.maths, s.xA));
    const fromAdmin = await save(admin, es.maths, s.xA, opened.data.revision, [
      { studentId: s.s1, theory: 70 },
    ]);
    expect(fromAdmin.status).toBe(200);
    const stale = await save(arun, es.maths, s.xA, opened.data.revision, [
      { studentId: s.s1, theory: 71 },
    ]);
    expect(stale.status).toBe(409);
    expect(stale.error.message).toMatch(/Reload the sheet/);
    expect((await submit(arun, es.maths, s.xA, opened.data.revision)).status).toBe(409);
    const stored = await db.selectFrom('mark_entries').select('theory_cm').execute();
    expect(stored).toEqual([{ theory_cm: 7000 }]);
  }, 60_000);

  it('configuration changes cannot invalidate marks; closing an exam freezes it', async () => {
    const { exam, es } = await setupExam(admin, s, classX);
    await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
    const config = (over: Record<string, unknown>) =>
      call(admin, 'PUT', `/admin/exams/${exam}/classes/${classX}/subjects`, {
        subjects: [
          { subjectId: s.maths, theoryMax: 100, passMarks: 35, ...over },
          { subjectId: s.science, theoryMax: 80, practicalMax: 20, passMarks: 35 },
          { subjectId: s.english, theoryMax: 50, passMarks: 18, normalizedMax: 100 },
        ],
      });
    // Removing Drawing is fine: it has no marks (its empty sheet goes with it).
    await assign(admin, es.drawing, s.xA, s.priya);
    expect((await config({})).status).toBe(200);
    const saved = await save(admin, es.maths, s.xA, null, [{ studentId: s.s1, theory: 90 }]);
    expect((await config({ theoryMax: 80 })).status).toBe(409);
    expect((await config({ passMarks: 40 })).status).toBe(200); // a draft: settings may still change
    const withoutMaths = await call(
      admin,
      'PUT',
      `/admin/exams/${exam}/classes/${classX}/subjects`,
      {
        subjects: [{ subjectId: s.science, theoryMax: 80, practicalMax: 20, passMarks: 35 }],
      },
    );
    expect(withoutMaths.status).toBe(409);
    expect(withoutMaths.error.message).toMatch(/already has marks/);
    await save(admin, es.maths, s.xA, saved.data.revision, [
      { studentId: s.s2, theory: 50 },
      { studentId: s.s3, theory: 60 },
    ]);
    const current = await call(admin, 'GET', sheetUrl(es.maths, s.xA));
    expect((await submit(admin, es.maths, s.xA, current.data.revision)).status).toBe(200);
    const view = await call(admin, 'GET', `/admin/exams/${exam}/classes/${classX}/subjects`);
    expect(view.data.find((x: any) => x.subjectId === s.maths)).toMatchObject({
      hasMarks: true,
      locked: true,
    });
    expect((await config({ passMarks: 30 })).status).toBe(409); // submitted: unlock first

    // A grade scale edited later does not rewrite submitted results (settings kept on the sheet).
    await call(admin, 'PUT', `/admin/grade-scales/${s.scale}`, {
      name: 'MK scale',
      bands: [
        { label: 'PASS', minPercent: 35, remark: null },
        { label: 'LOW', minPercent: 0, remark: null },
      ],
    });
    const after = await call(admin, 'GET', sheetUrl(es.maths, s.xA));
    expect(after.data.rows[0].grade).toBe('A+');
    expect(after.data.structure.gradeScale.bands[0].label).toBe('A+');

    // Marks entered: cannot go back to draft. Closed: frozen, even for administrators.
    expect(
      (await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'DRAFT' })).status,
    ).toBe(409);
    expect(
      (await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'CLOSED' })).status,
    ).toBe(200);
    const closed = await save(admin, es.science, s.xA, null, [
      { studentId: s.s1, theory: 10, practical: 5 },
    ]);
    expect(closed.status).toBe(409);
    expect(closed.error.message).toMatch(/closed/);
    expect(
      (
        await call(admin, 'POST', '/marks/sheet/unlock', {
          examSubjectId: es.maths,
          sectionId: s.xA,
          revision: after.data.revision,
          reason: 'Closed exam check',
        })
      ).status,
    ).toBe(409);
    expect((await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' })).status).toBe(
      200,
    );
  }, 60_000);
});

describe('marks transactions', () => {
  it('AO: a storage failure part-way through Submit finalises nothing', async () => {
    const opened = await openTestDatabase('sqlite');
    const state = { failAfter: -1 };
    const wrap = (repos: Repositories): Repositories => ({
      ...repos,
      marks: new Proxy(repos.marks, {
        get(target, prop, receiver) {
          if (prop === 'setEntryDerived') {
            return async (...args: Parameters<typeof target.setEntryDerived>) => {
              if (state.failAfter === 0) throw new Error('simulated storage failure');
              state.failAfter -= 1;
              return target.setEntryDerived(...args);
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
      clock: new MutableClock('2026-09-21T03:30:00.000Z'),
    });
    try {
      const admin = await adminSession(h);
      const s = await setupSchool(h, admin, opened.db);
      const classX = (
        await opened.db
          .selectFrom('sections')
          .select('class_id')
          .where('id', '=', s.xA)
          .executeTakeFirstOrThrow()
      ).class_id;
      const { exam, es } = await setupExam(admin, s, classX);
      await call(admin, 'PUT', `/admin/exams/${exam}/stage`, { stage: 'OPEN' });
      const saved = await save(admin, es.maths, s.xA, null, [
        { studentId: s.s1, theory: 10 },
        { studentId: s.s2, theory: 20 },
        { studentId: s.s3, theory: 30 },
      ]);
      state.failAfter = 1; // the second student's result fails to store
      const res = await submit(admin, es.maths, s.xA, saved.data.revision);
      expect(res.status).toBe(500);
      expect(res.raw).not.toMatch(/simulated/);
      const sheet = await opened.db.selectFrom('mark_sheets').selectAll().executeTakeFirstOrThrow();
      expect(sheet).toMatchObject({
        status: 'DRAFT',
        submitted_at: null,
        calculation: null,
        revision: saved.data.revision,
      });
      const entries = await opened.db
        .selectFrom('mark_entries')
        .select(['total_cm', 'grade'])
        .execute();
      expect(entries.every((e) => e.total_cm === null && e.grade === null)).toBe(true);
      expect(
        await opened.db
          .selectFrom('audit_logs')
          .selectAll()
          .where('action', '=', 'marks.submitted')
          .execute(),
      ).toHaveLength(0);
    } finally {
      await h.close();
    }
  }, 60_000);
});
