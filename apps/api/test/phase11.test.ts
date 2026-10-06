/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { annualPercentBp } from '@ttlmhss/shared';
import type { Database } from '../src/data/kysely/database-schema.js';
import { suggestRemark } from '../src/modules/reports/annual-report.service.js';
import { adminSession, call, sessionFor, type Session } from './support/api-helpers.js';
import {
  assignClassTeacher,
  linkStudent,
  linkTeacher,
  seedAccount,
} from './support/auth-fixtures.js';
import { inspectPdf } from './support/pdf-inspect.js';
import {
  MutableClock,
  buildTestApp,
  openTestDatabase,
  type TestApp,
  type TestDriver,
} from './support/test-harness.js';

/*
 * Phase 11 — reports, PDFs and annual reports. TEST DATA ONLY: synthetic names in throwaway
 * databases; the school is configured through the real APIs. Clock: Monday 21 September 2026.
 * Two exams weighted 40 % and 60 % (deliberately not equal).
 */
const NOW = '2026-06-01T00:00:00.000Z';
const MON = '2026-09-21';

describe('annual weighting (shared definition)', () => {
  it('weighs exam percentages by the configured weightage, half-up to 2 decimals', () => {
    expect(
      annualPercentBp([
        { percentBp: 7000, weightBp: 4000 },
        { percentBp: 8000, weightBp: 6000 },
      ]),
    ).toBe(7600);
    // Not an average: equal weighting would give 75.
    expect(
      annualPercentBp([
        { percentBp: 6667, weightBp: 3333 },
        { percentBp: 5000, weightBp: 6667 },
      ]),
    ).toBe(5556);
    expect(annualPercentBp([{ percentBp: 7000, weightBp: 4000 }])).toBeNull(); // not 100 %
    expect(annualPercentBp([])).toBeNull();
  });
  it('suggests a factual remark (no invented judgement)', () => {
    expect(suggestRemark('Asha', 76, 2, 90, 1, 0)).toBe(
      'Asha achieved an annual percentage of 76% across 2 weighted exams. Attendance for the year was 90%. 1 achievement was recorded. Behaviour has not been assessed.',
    );
  });
});

interface School {
  year: string;
  classX: string;
  xA: string;
  xB: string;
  p1: string;
  p2: string;
  maths: string;
  science: string;
  term1: string;
  term2: string;
  es: Record<string, { maths: string; science: string }>;
  s1: string;
  s2: string;
  s3: string;
}

async function setup(h: TestApp, admin: Session, db: Kysely<Database>): Promise<School> {
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await call(admin, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  };
  const year = await ok('POST', '/admin/academic-years', {
    label: 'P11-2026',
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
  const x = await ok('POST', '/admin/classes', { name: 'P11-X', displayOrder: 10 });
  await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
  const xc = await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'B' });
  const sec = (n: string) => xc.sections.find((s: any) => s.name === n).id;
  const maths = await ok('POST', '/admin/subjects', {
    name: 'P11 Maths',
    code: null,
    displayOrder: 1,
  });
  const science = await ok('POST', '/admin/subjects', {
    name: 'P11 Science',
    code: null,
    displayOrder: 2,
  });

  const teacher = async (username: string, name: string) =>
    linkTeacher(db, await seedAccount(h.deps, { username, role: 'TEACHER' }), name);
  const kumar = await teacher('p11.kumar', 'P11 Kumar');
  const priya = await teacher('p11.priya', 'P11 Priya');
  const arun = await teacher('p11.arun', 'P11 Arun');
  for (const s of [maths, science])
    await ok('POST', `/admin/teachers/${arun}/subjects`, { subjectId: s.id });
  await assignClassTeacher(db, kumar, year.id, sec('A'));
  await assignClassTeacher(db, priya, year.id, sec('B'));

  const student = async (username: string, section: string, roll: string, name?: string) => {
    const id = username
      ? await linkStudent(
          db,
          await seedAccount(h.deps, { username, role: 'STUDENT' }),
          name ?? `P11 Student ${username.slice(4)}`,
        )
      : '';
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
  const s1 = await student('p11.s1', sec('A'), '1');
  const s2 = await student('p11.s2', sec('A'), '2');
  const s3 = await student('p11.s3', sec('B'), '1');

  await ok('POST', `/timetable/years/${year.id}/draft`);
  for (const [section, period, subject] of [
    [sec('A'), slot('Period 1'), maths.id],
    [sec('B'), slot('Period 2'), maths.id],
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
          subjectId: subject,
          teacherId: arun,
        },
      ],
    });
  }
  await ok('POST', `/timetable/years/${year.id}/draft/publish`);

  const es: School['es'] = {};
  const exams: string[] = [];
  for (const [name, weight, start] of [
    ['P11 Term 1', 40, '2026-07-06'],
    ['P11 Term 2', 60, '2026-09-14'],
  ] as const) {
    const exam = await ok('POST', '/admin/exams', {
      academicYearId: year.id,
      name,
      startDate: start,
      endDate: start,
      weightagePercent: weight,
      rankScope: 'SECTION',
      displayOrder: exams.length + 1,
    });
    exams.push(exam.id);
    const subjects = await ok('PUT', `/admin/exams/${exam.id}/classes/${x.id}/subjects`, {
      subjects: [
        { subjectId: maths.id, theoryMax: 100, passMarks: 35 },
        { subjectId: science.id, theoryMax: 100, passMarks: 35 },
      ],
    });
    es[exam.id] = {
      maths: subjects.find((s: any) => s.subjectId === maths.id).id,
      science: subjects.find((s: any) => s.subjectId === science.id).id,
    };
    await ok('PUT', `/admin/exams/${exam.id}/stage`, { stage: 'OPEN' });
    for (const subject of Object.values(es[exam.id]!)) {
      for (const section of [sec('A'), sec('B')]) {
        await ok('PUT', `/admin/exam-subjects/${subject}/sections/${section}/teacher`, {
          teacherId: arun,
        });
      }
    }
  }
  return {
    year: year.id,
    classX: x.id,
    xA: sec('A'),
    xB: sec('B'),
    p1: slot('Period 1'),
    p2: slot('Period 2'),
    maths: maths.id,
    science: science.id,
    term1: exams[0]!,
    term2: exams[1]!,
    es,
    s1,
    s2,
    s3,
  };
}

describe.each<TestDriver>(['sqlite', 'postgres'])('reports and annual reports (%s)', (driver) => {
  let h: TestApp;
  let db: Kysely<Database>;
  let admin: Session;
  let s: School;
  let arun: Session;

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    db = opened.db;
    h = await buildTestApp({
      dataStore: opened.store,
      clock: new MutableClock('2026-09-21T03:30:00.000Z'),
    });
    admin = await adminSession(h);
    s = await setup(h, admin, db);
    arun = await sessionFor(h, 'p11.arun');
  }, 180_000);
  afterEach(async () => {
    await h.close();
  });

  /** Arun enters and submits one sheet: { studentId: theory }. */
  async function submit(
    exam: string,
    subject: 'maths' | 'science',
    section: string,
    marks: Record<string, number>,
  ) {
    const key = { examSubjectId: s.es[exam]![subject], sectionId: section };
    const sheet = await call(
      arun,
      'GET',
      `/marks/sheet?examSubjectId=${key.examSubjectId}&sectionId=${section}`,
    );
    const saved = await call(arun, 'PUT', '/marks/sheet', {
      ...key,
      revision: sheet.data.revision,
      marks: Object.entries(marks).map(([studentId, theory]) => ({
        studentId,
        theory,
        internal: null,
        practical: null,
      })),
    });
    expect(saved.status, saved.raw).toBe(200);
    const done = await call(arun, 'POST', '/marks/sheet/submit', {
      ...key,
      revision: saved.data.revision,
    });
    expect(done.status, done.raw).toBe(200);
    return done.data;
  }
  /** Everyone in X-A gets marks in both exams: s1 70 % then 80 %; s2 50 % then 60 %. */
  async function allMarks() {
    await submit(s.term1, 'maths', s.xA, { [s.s1]: 80, [s.s2]: 50 });
    await submit(s.term1, 'science', s.xA, { [s.s1]: 60, [s.s2]: 50 });
    await submit(s.term2, 'maths', s.xA, { [s.s1]: 90, [s.s2]: 60 });
    return submit(s.term2, 'science', s.xA, { [s.s1]: 70, [s.s2]: 60 });
  }
  const pdfOf = async (who: Session, url: string) => {
    const res = await who.app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: { cookie: who.cookie },
    });
    if (process.env.DUMP_REPORTS && res.statusCode === 200) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        `${process.env.DUMP_REPORTS}/${url.split('?')[0]!.replace(/\W+/g, '_')}-${res.rawPayload.length}.${res.headers['content-type'] === 'application/pdf' ? 'pdf' : 'xlsx'}`,
        res.rawPayload,
      );
    }
    return res;
  };

  it('exam report card: Phase 8B visibility, completeness, scope and a real A4 PDF', async () => {
    const anon = { app: h.app, cookie: '' };
    expect((await call(anon, 'GET', '/reports/options')).status).toBe(401);
    const s1 = await sessionFor(h, 'p11.s1');
    const kumar = await sessionFor(h, 'p11.kumar');
    const priya = await sessionFor(h, 'p11.priya');

    await submit(s.term1, 'maths', s.xA, { [s.s1]: 80, [s.s2]: 50 });
    const partial = await call(s1, 'GET', `/reports/exam-card?examId=${s.term1}`);
    expect(partial.status, partial.raw).toBe(200);
    expect(partial.data).toMatchObject({
      kind: 'EXAM_REPORT_CARD',
      official: false,
      result: { complete: false, availableCount: 1, requiredCount: 2 },
    });
    const refused = await pdfOf(s1, `/reports/exam-card?examId=${s.term1}&format=pdf`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/incomplete \(1 of 2 subjects published\)/);

    await submit(s.term1, 'science', s.xA, { [s.s1]: 60, [s.s2]: 50 });
    const res = await pdfOf(s1, `/reports/exam-card?examId=${s.term1}&format=pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="[A-Za-z0-9_-]+_P11-2026_ExamReport_[A-Za-z0-9-]+_P11-Term-1\.pdf"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const pdf = inspectPdf(res.rawPayload);
    expect(pdf.header).toBe('%PDF-');
    expect(pdf.trailer).toBe(true);
    expect(pdf.pages).toBe(1);
    expect(pdf.mediaBoxes[0]).toEqual([0, 0, 595.28, 841.89]); // A4 portrait
    for (const text of [
      'Exam Report Card',
      'P11 Student s1',
      'P11 Maths',
      'P11 Science',
      '140 / 200',
      '70%',
      'Pass',
      '1 of 2',
      'Page 1 of 1',
      'Class Teacher',
      'Principal / Head of Institution',
    ]) {
      expect(pdf.text, text).toContain(text);
    }
    expect(pdf.text).not.toContain('P11 Student s2');

    // Scope: own student only for students; class teacher own section; subject teacher none.
    expect(
      (await call(s1, 'GET', `/reports/exam-card?examId=${s.term1}&studentId=${s.s2}`)).status,
    ).toBe(403);
    expect(
      (await call(kumar, 'GET', `/reports/exam-card?examId=${s.term1}&studentId=${s.s1}`)).status,
    ).toBe(200);
    expect(
      (await call(priya, 'GET', `/reports/exam-card?examId=${s.term1}&studentId=${s.s1}`)).status,
    ).toBe(403);
    expect(
      (await call(arun, 'GET', `/reports/exam-card?examId=${s.term1}&studentId=${s.s1}`)).status,
    ).toBe(403);
    expect(
      (await call(kumar, 'GET', `/reports/exam-card?examId=${randomUUID()}&studentId=${s.s1}`))
        .status,
    ).toBe(403);
    expect((await call(admin, 'GET', `/reports/exam-card?examId=${s.term1}`)).status).toBe(409); // staff must name a student

    // An unlocked subject is hidden again and the official card disappears (Phase 8B).
    const sheet = await call(
      kumar,
      'GET',
      `/marks/sheet?examSubjectId=${s.es[s.term1]!.maths}&sectionId=${s.xA}`,
    );
    const unlock = await call(kumar, 'POST', '/marks/sheet/unlock', {
      examSubjectId: s.es[s.term1]!.maths,
      sectionId: s.xA,
      revision: sheet.data.revision,
      reason: 'Recheck the totals',
    });
    expect(unlock.status, unlock.raw).toBe(200);
    const after = await call(s1, 'GET', `/reports/exam-card?examId=${s.term1}`);
    expect(after.data.official).toBe(false);
    expect(
      after.data.result.subjects.find((x: any) => x.subjectName === 'P11 Maths').available,
    ).toBe(false);
    expect((await pdfOf(s1, `/reports/exam-card?examId=${s.term1}&format=pdf`)).statusCode).toBe(
      409,
    );
  });

  it('mark sheet: Phase 8B authorisation, landscape A4 with the stored values', async () => {
    const kumar = await sessionFor(h, 'p11.kumar');
    const priya = await sessionFor(h, 'p11.priya');
    const s1 = await sessionFor(h, 'p11.s1');
    await submit(s.term1, 'maths', s.xA, { [s.s1]: 80, [s.s2]: 0 });
    const url = `/reports/mark-sheet?examSubjectId=${s.es[s.term1]!.maths}&sectionId=${s.xA}`;
    const json = await call(arun, 'GET', url);
    expect(json.status, json.raw).toBe(200);
    expect(json.data.sheet.rows.map((r: any) => [r.total, r.result])).toEqual([
      [80, 'PASS'],
      [0, 'FAIL'],
    ]);
    const res = await pdfOf(arun, `${url}&format=pdf`);
    expect(res.statusCode).toBe(200);
    const pdf = inspectPdf(res.rawPayload);
    expect(pdf.mediaBoxes[0]).toEqual([0, 0, 841.89, 595.28]); // A4 landscape
    for (const text of ['Mark Sheet', 'P11 Arun', 'Theory (100)', 'P11 Student s1', 'Submitted']) {
      expect(pdf.text, text).toContain(text);
    }
    expect((await call(kumar, 'GET', url)).status).toBe(200);
    expect((await call(priya, 'GET', url)).status).toBe(403);
    expect((await call(s1, 'GET', url)).status).toBe(403);
  });

  it('attendance reports: same calculation as the attendance pages, scope, PDF and real XLSX', async () => {
    const kumar = await sessionFor(h, 'p11.kumar');
    const priya = await sessionFor(h, 'p11.priya');
    const s1 = await sessionFor(h, 'p11.s1');
    const reg = await call(arun, 'PUT', '/attendance/register', {
      date: MON,
      periodId: s.p1,
      sectionId: s.xA,
      revision: null,
      marks: [
        { studentId: s.s1, status: 'P' },
        { studentId: s.s2, status: 'A' },
      ],
    });
    expect(reg.status, reg.raw).toBe(200);
    const range = 'from=2026-09-01&to=2026-09-21';
    const own = await call(s1, 'GET', `/reports/attendance/student?${range}`);
    expect(own.status, own.raw).toBe(200);
    const page = await call(s1, 'GET', `/attendance/me?${range}`);
    expect(own.data.attendance.counts).toEqual(page.data.counts);
    expect(own.data.attendance.counts).toMatchObject({ P: 1, A: 0, notMarked: 0, percentage: 100 });
    expect(
      (await call(s1, 'GET', `/reports/attendance/student?studentId=${s.s2}&${range}`)).status,
    ).toBe(403);
    const pdf = inspectPdf(
      (await pdfOf(s1, `/reports/attendance/student?${range}&format=pdf`)).rawPayload,
    );
    for (const text of [
      'Attendance Report',
      'Lesson by lesson',
      'P11 Maths',
      'P11 Arun',
      'Present',
      'NOT MARKED',
    ]) {
      expect(pdf.text, text).toContain(text);
    }

    const classUrl = `/reports/attendance/class?sectionId=${s.xA}&${range}`;
    const cls = await call(kumar, 'GET', classUrl);
    expect(cls.status, cls.raw).toBe(200);
    const summary = await call(
      kumar,
      'GET',
      `/attendance/class-summary?sectionId=${s.xA}&${range}`,
    );
    expect(cls.data.summary).toEqual(summary.data);
    // The timetable was published on 21 September: earlier Mondays had no lesson in force.
    expect(cls.data.lessonCount).toBe(1);
    for (const who of [priya, arun, s1])
      expect((await call(who, 'GET', classUrl)).status).toBe(403);

    const xlsx = await pdfOf(kumar, `${classUrl}&format=xlsx`);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK'); // a real Office Open XML zip
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as any);
    const lessons = wb.getWorksheet('Lessons')!;
    expect(lessons.getRow(1).values).toEqual([
      undefined,
      'Date',
      'Period',
      'Admission number',
      'Roll',
      'Student',
      'Class',
      'Section',
      'Subject',
      'Teacher',
      'Status',
      'Meaning',
    ]);
    expect(lessons.rowCount).toBe(1 + 1 * 2); // 1 lesson × 2 students
    const marked = lessons.getRows(2, 2)!.filter((r) => r.getCell(1).value === MON);
    expect(marked.map((r) => r.getCell(10).value).sort()).toEqual(['A', 'P']);
    const sum = wb.getWorksheet('Summary')!;
    expect(sum.getRow(2).getCell(3).value).toBe('P11 Student s1');
    expect(sum.getRow(2).getCell(9).value).toBe(100);
    expect(sum.getRow(3).getCell(9).value).toBe(0);
  });

  it('class attendance PDF runs over several pages with the table header repeated', async () => {
    // Sixty synthetic students in X-B (test data only).
    for (let i = 0; i < 60; i += 1) {
      const id = randomUUID();
      const userId = randomUUID();
      await db
        .insertInto('users')
        .values({
          id: userId,
          username: `p11.many${i}`,
          role: 'STUDENT',
          status: 'ACTIVE',
          created_at: NOW,
          updated_at: NOW,
        })
        .execute();
      await db
        .insertInto('students')
        .values({
          id,
          user_id: userId,
          admission_number: `P11-M-${i}`,
          full_name: `P11 Many ${String(i).padStart(2, '0')}`,
          admission_date: '2026-05-15',
          status: 'ACTIVE',
          created_at: NOW,
          updated_at: NOW,
        } as any)
        .execute();
      await db
        .insertInto('enrolments')
        .values({
          id: randomUUID(),
          student_id: id,
          academic_year_id: s.year,
          section_id: s.xB,
          roll_number: String(i + 2),
          status: 'ACTIVE',
          started_on: '2026-05-15',
          ended_on: null,
          created_at: NOW,
          updated_at: NOW,
        })
        .execute();
    }
    const res = await pdfOf(
      admin,
      `/reports/attendance/class?sectionId=${s.xB}&from=2026-09-01&to=2026-09-21&format=pdf`,
    );
    expect(res.statusCode, res.body).toBe(200);
    const pdf = inspectPdf(res.rawPayload);
    expect(pdf.pages).toBeGreaterThanOrEqual(2);
    expect(pdf.mediaBoxes.every((b) => b.join() === '0,0,595.28,841.89')).toBe(true);
    expect(pdf.text).toContain(`Page 1 of ${pdf.pages}`);
    expect(pdf.text).toContain(`Page ${pdf.pages} of ${pdf.pages}`);
    expect(pdf.text.split('Adm. no.').length - 1).toBe(pdf.pages); // header on every page
    expect(pdf.text).toContain('P11 Many 59');
  });

  it('student performance report: own data only, existing results, attendance and records', async () => {
    const s1 = await sessionFor(h, 'p11.s1');
    const kumar = await sessionFor(h, 'p11.kumar');
    await allMarks();
    const own = await call(s1, 'GET', '/reports/performance');
    expect(own.status, own.raw).toBe(200);
    expect(own.data.exams.map((e: any) => [e.exam.name, e.summary.percentage])).toEqual([
      ['P11 Term 1', 70],
      ['P11 Term 2', 80],
    ]);
    expect(own.data.behaviour).toEqual([]);
    expect(own.data.achievements).toEqual([]);
    expect((await call(s1, 'GET', `/reports/performance?studentId=${s.s2}`)).status).toBe(403);
    expect((await call(kumar, 'GET', `/reports/performance?studentId=${s.s3}`)).status).toBe(403);
    expect((await call(kumar, 'GET', `/reports/performance?studentId=${s.s1}`)).status).toBe(200);
    expect((await call(arun, 'GET', `/reports/performance?studentId=${s.s1}`)).status).toBe(403);
    const pdf = inspectPdf((await pdfOf(s1, '/reports/performance?format=pdf')).rawPayload);
    for (const text of [
      'Student Performance Report',
      'P11 Term 1',
      'P11 Term 2',
      'Not yet assessed.',
      'No records.',
    ]) {
      expect(pdf.text, text).toContain(text);
    }
  });

  it('annual report: configured weighting, draft → finalized → published, frozen snapshot', async () => {
    const s1 = await sessionFor(h, 'p11.s1');
    const s2 = await sessionFor(h, 'p11.s2');
    const kumar = await sessionFor(h, 'p11.kumar');
    const priya = await sessionFor(h, 'p11.priya');
    const url = `/reports/annual?academicYearId=${s.year}&studentId=${s.s1}`;

    let v = (await call(kumar, 'GET', url)).data;
    expect(v.status).toBe('NONE');
    expect(v.content.annual).toMatchObject({ weightageTotalPercent: 100, percentage: null });
    expect(v.content.problems.join(' ')).toMatch(/P11 Term 1: result incomplete \(0 of 2/);
    expect(v.actions).toMatchObject({ prepare: true, finalize: false, publish: false });
    for (const who of [priya, arun]) expect((await call(who, 'GET', url)).status).toBe(403);
    expect((await call(s1, 'GET', `/reports/annual?academicYearId=${s.year}`)).status).toBe(404);

    const list = await call(
      kumar,
      'GET',
      `/reports/annual/section?academicYearId=${s.year}&sectionId=${s.xA}`,
    );
    expect(list.data.students.map((x: any) => [x.student.fullName, x.status])).toEqual([
      ['P11 Student s1', 'NONE'],
      ['P11 Student s2', 'NONE'],
    ]);
    expect(
      (
        await call(
          kumar,
          'GET',
          `/reports/annual/section?academicYearId=${s.year}&sectionId=${s.xB}`,
        )
      ).status,
    ).toBe(403);

    const prepared = await call(kumar, 'POST', '/reports/annual', {
      academicYearId: s.year,
      studentId: s.s1,
    });
    expect(prepared.status, prepared.raw).toBe(201);
    expect(prepared.data).toMatchObject({ status: 'DRAFT', revision: 1 });
    const id = prepared.data.id;
    expect(
      (await call(kumar, 'POST', '/reports/annual', { academicYearId: s.year, studentId: s.s1 }))
        .status,
    ).toBe(409);
    expect((await call(s1, 'POST', `/reports/annual/${id}/finalize`, { revision: 1 })).status).toBe(
      403,
    );
    // No remark yet → cannot finalize.
    expect(
      (await call(kumar, 'POST', `/reports/annual/${id}/finalize`, { revision: 1 })).status,
    ).toBe(409);
    const remark = await call(kumar, 'PUT', `/reports/annual/${id}/remark`, {
      remark: 'A steady and sincere year.',
      revision: 1,
    });
    expect(remark.status, remark.raw).toBe(200);
    // Results incomplete → cannot finalize.
    const early = await call(kumar, 'POST', `/reports/annual/${id}/finalize`, { revision: 2 });
    expect(early.status).toBe(409);
    expect(early.error.message).toMatch(/cannot be finalized yet/);

    await allMarks();
    v = (await call(kumar, 'GET', url)).data;
    expect(v.content.problems).toEqual([]);
    // 70 % × 40 % + 80 % × 60 % = 76 % (an equal average would be 75 %).
    expect(v.content.annual).toMatchObject({
      weightageTotalPercent: 100,
      percentage: 76,
      contributions: [
        { examName: 'P11 Term 1', weightagePercent: 40, percentage: 70, weighted: 28 },
        { examName: 'P11 Term 2', weightagePercent: 60, percentage: 80, weighted: 48 },
      ],
    });
    expect(v.content.suggestedRemark).toMatch(/annual percentage of 76%/);
    expect(v.content.finalRemark).toBe('A steady and sincere year.');
    const draftPdf = inspectPdf((await pdfOf(kumar, `${url}&format=pdf`)).rawPayload);
    expect(draftPdf.text).toContain('DRAFT');
    expect(draftPdf.text).toContain('SYSTEM SUGGESTION');

    const finalized = await call(kumar, 'POST', `/reports/annual/${id}/finalize`, { revision: 2 });
    expect(finalized.status, finalized.raw).toBe(200);
    expect(finalized.data).toMatchObject({
      status: 'FINALIZED',
      frozen: true,
      actions: { publish: false },
    });
    expect(
      (await call(kumar, 'PUT', `/reports/annual/${id}/remark`, { remark: 'Changed', revision: 3 }))
        .status,
    ).toBe(409);
    expect((await call(s1, 'GET', `/reports/annual?academicYearId=${s.year}`)).status).toBe(404);
    expect(
      (await call(kumar, 'POST', `/reports/annual/${id}/publish`, { revision: 3 })).status,
    ).toBe(403);

    // Later changes to marks and configuration never touch the finalized report.
    const sheet = await call(
      kumar,
      'GET',
      `/marks/sheet?examSubjectId=${s.es[s.term2]!.maths}&sectionId=${s.xA}`,
    );
    const unlocked = await call(kumar, 'POST', '/marks/sheet/unlock', {
      examSubjectId: s.es[s.term2]!.maths,
      sectionId: s.xA,
      revision: sheet.data.revision,
      reason: 'Correct a total',
    });
    expect(unlocked.status, unlocked.raw).toBe(200);
    await submit(s.term2, 'maths', s.xA, { [s.s1]: 50, [s.s2]: 60 });
    expect(
      (await call(admin, 'PATCH', `/admin/exams/${s.term2}`, { name: 'P11 Final Exam' })).status,
    ).toBe(200);
    v = (await call(kumar, 'GET', url)).data;
    expect(v.content.annual.percentage).toBe(76);
    expect(v.content.exams[1].exam.name).toBe('P11 Term 2');

    const published = await call(admin, 'POST', `/reports/annual/${id}/publish`, { revision: 3 });
    expect(published.status, published.raw).toBe(200);
    expect(published.data.status).toBe('PUBLISHED');
    // The student sees their own published report; no system suggestion; nobody else's.
    const mine = await call(s1, 'GET', `/reports/annual?academicYearId=${s.year}`);
    expect(mine.status).toBe(200);
    expect(mine.data.content.annual.percentage).toBe(76);
    expect(mine.data.content.suggestedRemark).toBe('');
    expect(mine.data.actions).toEqual({
      prepare: false,
      editRemark: false,
      finalize: false,
      publish: false,
      unpublish: false,
      reopen: false,
    });
    expect((await call(s1, 'GET', '/reports/annual/mine')).data.items).toHaveLength(1);
    expect(
      (await call(s1, 'GET', `/reports/annual?academicYearId=${s.year}&studentId=${s.s2}`)).status,
    ).toBe(403);
    expect((await call(s2, 'GET', `/reports/annual?academicYearId=${s.year}`)).status).toBe(404);
    expect((await call(s2, 'GET', '/reports/annual/mine')).data.items).toEqual([]);
    const official = inspectPdf(
      (await pdfOf(s1, `/reports/annual?academicYearId=${s.year}&format=pdf`)).rawPayload,
    );
    for (const text of [
      'Annual Report',
      'A. Student information',
      'F. Overall academic performance',
      '76%',
      'A steady and sincere year.',
      'P11 Term 2',
    ]) {
      expect(official.text, text).toContain(text);
    }
    expect(official.text).not.toContain('DRAFT');
    expect(official.text).not.toContain('SYSTEM SUGGESTION');
    expect(official.pages).toBeGreaterThanOrEqual(1);

    // Reopen: administrators only, published reports must be unpublished first, reason required.
    expect(
      (
        await call(admin, 'POST', `/reports/annual/${id}/reopen`, {
          revision: 4,
          reason: 'Marks corrected',
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(admin, 'POST', `/reports/annual/${id}/unpublish`, { revision: 4 })).status,
    ).toBe(200);
    expect((await call(s1, 'GET', `/reports/annual?academicYearId=${s.year}`)).status).toBe(404);
    expect(
      (
        await call(kumar, 'POST', `/reports/annual/${id}/reopen`, {
          revision: 5,
          reason: 'Marks corrected',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(admin, 'POST', `/reports/annual/${id}/reopen`, { revision: 5, reason: 'no' }))
        .status,
    ).toBe(400);
    const reopened = await call(admin, 'POST', `/reports/annual/${id}/reopen`, {
      revision: 5,
      reason: 'Marks corrected',
    });
    expect(reopened.status, reopened.raw).toBe(200);
    expect(reopened.data).toMatchObject({ status: 'DRAFT', frozen: false });
    // Live again: Term 2 is now (50 + 70) / 2 = 60 %, so 70 × 0.4 + 60 × 0.6 = 64 %.
    expect(reopened.data.content.annual.percentage).toBe(64);
    expect(reopened.data.content.exams[1].exam.name).toBe('P11 Final Exam');

    const audit = await db
      .selectFrom('audit_logs')
      .select(['action', 'reason'])
      .where('entity_type', '=', 'annual_report')
      .where('entity_id', '=', id)
      .orderBy('occurred_at')
      .execute();
    expect(audit.map((a) => a.action).sort()).toEqual(
      [
        'annual_report.prepared',
        'annual_report.remark_changed',
        'annual_report.finalized',
        'annual_report.published',
        'annual_report.unpublished',
        'annual_report.reopened',
      ].sort(),
    );
    expect(audit.find((a) => a.action === 'annual_report.reopened')!.reason).toBe(
      'Marks corrected',
    );
    const finalAudit = await db
      .selectFrom('audit_logs')
      .select('after_json')
      .where('action', '=', 'annual_report.finalized')
      .executeTakeFirstOrThrow();
    expect(finalAudit.after_json).not.toMatch(/%PDF/);
  });

  it('annual report refuses to finalize when the weightages do not total 100 %', async () => {
    const kumar = await sessionFor(h, 'p11.kumar');
    await allMarks();
    expect(
      (await call(admin, 'PATCH', `/admin/exams/${s.term2}`, { weightagePercent: 50 })).status,
    ).toBe(200);
    const prepared = await call(kumar, 'POST', '/reports/annual', {
      academicYearId: s.year,
      studentId: s.s1,
    });
    const id = prepared.data.id;
    expect(prepared.data.content.annual).toMatchObject({
      weightageTotalPercent: 90,
      percentage: null,
    });
    expect(prepared.data.content.problems).toEqual([
      'Exam weightages for P11-2026 total 90%, not 100% (School setup > Exams).',
    ]);
    await call(kumar, 'PUT', `/reports/annual/${id}/remark`, {
      remark: 'Good work all year.',
      revision: 1,
    });
    const refused = await call(kumar, 'POST', `/reports/annual/${id}/finalize`, { revision: 2 });
    expect(refused.status).toBe(409);
    expect(refused.error.message).toMatch(/total 90%/);
  });
});
