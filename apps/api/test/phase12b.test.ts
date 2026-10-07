/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminSession, call, sessionFor, type Session } from './support/api-helpers.js';
import { inspectPdf } from './support/pdf-inspect.js';
import {
  MutableClock,
  buildTestApp,
  openTestDatabase,
  signIn,
  type TestApp,
  type TestDriver,
} from './support/test-harness.js';

/*
 * Phase 12B — full integration. One school is configured ONLY through the real APIs (school
 * setup → people → timetable → attendance → exams/marks → results → reports) and the tests follow
 * data across module boundaries. TEST DATA ONLY: synthetic names in throwaway databases.
 * Clock: Monday 21 September 2026, 09:00 IST.
 */
const MON1 = '2026-09-14';
const MON2 = '2026-09-21';
const NEW_PASSWORD = 'Integration-pass-42';

interface School {
  year: string;
  classX: string;
  xA: string;
  xB: string;
  p1: string;
  p2: string;
  maths: string;
  science: string;
  arun: string;
  kumar: string;
  priya: string;
  term1: string;
  es: { maths: string; science: string };
  s1: string;
  s2: string;
  s3: string;
}

describe.each<TestDriver>(['sqlite', 'postgres'])('full integration (%s)', (driver) => {
  let h: TestApp;
  let admin: Session;
  let s: School;
  const sessions: Record<string, Session> = {};
  const usernames: Record<string, string> = {};
  let clock: MutableClock;

  async function ok(who: Session, method: string, url: string, body?: unknown) {
    const r = await call(who, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  }

  /** Admission through the API, then first sign-in with the issued temporary password. */
  async function admit(n: number, sectionId: string, year: string) {
    const created = await ok(admin, 'POST', '/admin/students', {
      admissionNumber: `INT/${n}`,
      admissionDate: '2026-06-01',
      fullName: `Integration Student ${n}`,
      academicYearId: year,
      sectionId,
      rollNumber: String(n),
    });
    const cred = await ok(admin, 'POST', `/admin/students/${created.id}/temporary-password`);
    const first = await signIn(h.app, cred.username, cred.temporaryPassword);
    const temp = { app: h.app, cookie: first.cookie! };
    // A temporary password allows nothing else until it is changed.
    expect((await call(temp, 'GET', '/portal/profile')).status).toBe(403);
    await ok(temp, 'POST', '/auth/change-password', {
      currentPassword: cred.temporaryPassword,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    usernames[`s${n}`] = cred.username;
    sessions[`s${n}`] = await sessionFor(h, cred.username, NEW_PASSWORD);
    return created.id as string;
  }

  async function setup(): Promise<School> {
    const a = (method: string, url: string, body?: unknown) => ok(admin, method, url, body);
    const year = await a('POST', '/admin/academic-years', {
      label: 'INT-2026',
      startDate: '2026-06-01',
      endDate: '2027-03-31',
    });
    await a('POST', `/admin/academic-years/${year.id}/make-current`);
    await a('PUT', `/admin/academic-years/${year.id}/working-days`, {
      workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    });
    await a('POST', `/admin/academic-years/${year.id}/periods`, {
      kind: 'LESSON',
      label: 'Period 1',
      periodNumber: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    const day = await a('POST', `/admin/academic-years/${year.id}/periods`, {
      kind: 'LESSON',
      label: 'Period 2',
      periodNumber: 2,
      startTime: '08:45',
      endTime: '09:30',
    });
    const slot = (label: string) => day.slots.find((x: any) => x.label === label).id;
    const x = await a('POST', '/admin/classes', { name: 'INT-X', displayOrder: 10 });
    await a('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
    const xc = await a('POST', `/admin/classes/${x.id}/sections`, { name: 'B' });
    const sec = (n: string) => xc.sections.find((q: any) => q.name === n).id;
    const maths = await a('POST', '/admin/subjects', {
      name: 'INT Maths',
      code: null,
      displayOrder: 1,
    });
    const science = await a('POST', '/admin/subjects', {
      name: 'INT Science',
      code: null,
      displayOrder: 2,
    });

    // Teachers through the API; accounts for them are seeded with known passwords.
    const teacher = async (n: number, name: string) => {
      const t = await a('POST', '/admin/teachers', {
        staffCode: `TCH-${n}`,
        fullName: name,
        designation: 'Teacher',
      });
      const cred = await a('POST', `/admin/teachers/${t.id}/temporary-password`);
      const first = await signIn(h.app, cred.username, cred.temporaryPassword);
      await ok({ app: h.app, cookie: first.cookie! }, 'POST', '/auth/change-password', {
        currentPassword: cred.temporaryPassword,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
      usernames[name] = cred.username;
      sessions[name] = await sessionFor(h, cred.username, NEW_PASSWORD);
      return t.id as string;
    };
    const arun = await teacher(1, 'Arun');
    const kumar = await teacher(2, 'Kumar');
    const priya = await teacher(3, 'Priya');
    for (const subj of [maths, science])
      await a('POST', `/admin/teachers/${arun}/subjects`, { subjectId: subj.id });
    await a('POST', '/admin/class-teachers', {
      academicYearId: year.id,
      sectionId: sec('A'),
      teacherId: kumar,
    });

    const s1 = await admit(1, sec('A'), year.id);
    const s2 = await admit(2, sec('A'), year.id);
    const s3 = await admit(3, sec('B'), year.id);

    await a('POST', `/timetable/years/${year.id}/draft`);
    for (const [section, period, subject] of [
      [sec('A'), slot('Period 1'), maths.id],
      [sec('B'), slot('Period 2'), science.id],
    ] as const) {
      await a('POST', `/timetable/years/${year.id}/draft/changes`, {
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
    await a('POST', `/timetable/years/${year.id}/draft/publish`);

    const exam = await a('POST', '/admin/exams', {
      academicYearId: year.id,
      name: 'INT Term 1',
      startDate: '2026-09-07',
      endDate: '2026-09-08',
      weightagePercent: 100,
      rankScope: 'SECTION',
      displayOrder: 1,
    });
    const subjects = await a('PUT', `/admin/exams/${exam.id}/classes/${x.id}/subjects`, {
      subjects: [
        // 50-mark paper converted to 100 (original retained).
        { subjectId: maths.id, theoryMax: 50, passMarks: 18, normalizedMax: 100 },
        { subjectId: science.id, theoryMax: 100, passMarks: 35 },
      ],
    });
    const es = {
      maths: subjects.find((q: any) => q.subjectId === maths.id).id,
      science: subjects.find((q: any) => q.subjectId === science.id).id,
    };
    await a('PUT', `/admin/exams/${exam.id}/stage`, { stage: 'OPEN' });
    for (const subject of Object.values(es))
      for (const section of [sec('A'), sec('B')])
        await a('PUT', `/admin/exam-subjects/${subject}/sections/${section}/teacher`, {
          teacherId: arun,
        });

    return {
      year: year.id,
      classX: x.id,
      xA: sec('A'),
      xB: sec('B'),
      p1: slot('Period 1'),
      p2: slot('Period 2'),
      maths: maths.id,
      science: science.id,
      arun,
      kumar,
      priya,
      term1: exam.id,
      es,
      s1,
      s2,
      s3,
    };
  }

  beforeEach(async () => {
    for (const key of Object.keys(usernames)) delete usernames[key];
    const opened = await openTestDatabase(driver);
    // Set up on 1 September (the timetable applies from its publication), then move to the 21st.
    clock = new MutableClock('2026-09-01T03:30:00.000Z');
    h = await buildTestApp(
      { dataStore: opened.store, clock },
      // Many sign-ins from one test "IP" (the per-IP sign-in limit is tested in phase12a).
      { env: { LOGIN_RATE_LIMIT_PER_MINUTE: '1000' } },
    );
    admin = await adminSession(h);
    s = await setup();
    clock.advance(20 * 86_400_000);
    admin = await sessionFor(h, 'test.admin');
    for (const [key, username] of Object.entries(usernames))
      sessions[key] = await sessionFor(h, username, NEW_PASSWORD);
  }, 180_000);
  afterEach(() => h.close());

  const arun = () => sessions.Arun!;
  const kumar = () => sessions.Kumar!;

  /** Arun saves (and optionally submits) one sheet. Marks keyed by studentId; null = "-". */
  async function sheet(
    subject: 'maths' | 'science',
    section: string,
    marks: Record<string, number | null>,
    submit = true,
  ) {
    const key = { examSubjectId: s.es[subject], sectionId: section };
    const view = await ok(
      arun(),
      'GET',
      `/marks/sheet?examSubjectId=${key.examSubjectId}&sectionId=${section}`,
    );
    const saved = await ok(arun(), 'PUT', '/marks/sheet', {
      ...key,
      revision: view.revision,
      marks: Object.entries(marks).map(([studentId, theory]) => ({
        studentId,
        theory,
        internal: null,
        practical: null,
      })),
    });
    if (!submit) return saved;
    return ok(arun(), 'POST', '/marks/sheet/submit', { ...key, revision: saved.revision });
  }

  const register = (who: Session, date: string, periodId: string, sectionId: string) =>
    call(
      who,
      'GET',
      `/attendance/register?date=${date}&periodId=${periodId}&sectionId=${sectionId}`,
    );

  it('timetable → attendance: the lesson resolves to the right register; nobody else can mark it', async () => {
    const lessons = await ok(arun(), 'GET', `/attendance/lessons?date=${MON2}`);
    expect(lessons.lessons.map((l: any) => l.subjectName ?? l.subject?.name)).toEqual(
      expect.arrayContaining([expect.stringMatching(/INT Maths/)]),
    );
    const reg = await register(arun(), MON2, s.p1, s.xA);
    expect(reg.status, reg.raw).toBe(200);
    const ctx = JSON.stringify(reg.data.context);
    expect(ctx).toContain('INT Maths');
    expect(ctx).toContain('Arun');
    expect(reg.data.rows.map((r: any) => r.studentId).sort()).toEqual([s.s1, s.s2].sort());
    expect(reg.data.access.editable).toBe(true);

    // The students' own timetable shows the same published lesson.
    const tt = await ok(sessions.s1!, 'GET', `/attendance/me/day?date=${MON2}`);
    expect(JSON.stringify(tt)).toContain('INT Maths');

    // Another teacher, another class, another period: refused.
    const mark = (who: Session, periodId: string, sectionId: string, studentId: string) =>
      call(who, 'PUT', '/attendance/register', {
        date: MON2,
        periodId,
        sectionId,
        revision: null,
        marks: [{ studentId, status: 'P' }],
      });
    expect((await mark(sessions.Priya!, s.p1, s.xA, s.s1)).status).toBe(403);
    expect((await mark(kumar(), s.p2, s.xB, s.s3)).status).toBe(403); // not his section
    expect([403, 404, 409]).toContain((await mark(arun(), s.p2, s.xA, s.s1)).status); // no lesson
    expect((await mark(sessions.s1!, s.p1, s.xA, s.s1)).status).toBe(403);
    const saved = await mark(arun(), s.p1, s.xA, s.s1);
    expect(saved.status, saved.raw).toBe(200);
  });

  it('a class change keeps attendance, results and reports with the class of that time', async () => {
    // Week 1 in X-A: attendance and the exam.
    await ok(arun(), 'PUT', '/attendance/register', {
      date: MON1,
      periodId: s.p1,
      sectionId: s.xA,
      revision: null,
      marks: [
        { studentId: s.s1, status: 'P' },
        { studentId: s.s2, status: 'A' },
      ],
    });
    await sheet('maths', s.xA, { [s.s1]: 40, [s.s2]: 30 });
    await sheet('science', s.xA, { [s.s1]: 70, [s.s2]: 60 });
    await sheet('maths', s.xB, { [s.s3]: 45 });
    await sheet('science', s.xB, { [s.s3]: 90 });

    // Move s1 to X-B from Wednesday 16 September.
    await ok(admin, 'POST', `/admin/students/${s.s1}/transfer`, {
      targetSectionId: s.xB,
      rollNumber: '9',
      effectiveDate: '2026-09-16',
    });

    // Exam rosters use the exam's roster date (BR-MARK-10 / BR-BEH-01), not the current class.
    const rosterIds = (v: any) => JSON.stringify(v);
    const sheetB = await ok(
      admin,
      'GET',
      `/marks/sheet?examSubjectId=${s.es.maths}&sectionId=${s.xB}`,
    );
    expect(rosterIds(sheetB)).not.toContain(s.s1);
    const behA = await ok(kumar(), 'GET', `/behaviour/sheet?examId=${s.term1}&sectionId=${s.xA}`);
    expect(rosterIds(behA)).toContain(s.s1);
    const behB = await ok(admin, 'GET', `/behaviour/sheet?examId=${s.term1}&sectionId=${s.xB}`);
    expect(rosterIds(behB)).not.toContain(s.s1);

    // Week 2: s1 is on the X-B register, no longer on X-A's.
    const regA = await register(arun(), MON2, s.p1, s.xA);
    const onA = regA.data.rows.filter((r: any) => r.onRoll !== false).map((r: any) => r.studentId);
    expect(onA).toEqual([s.s2]);
    const regB = await register(arun(), MON2, s.p2, s.xB);
    expect(regB.data.rows.map((r: any) => r.studentId).sort()).toEqual([s.s1, s.s3].sort());
    await ok(arun(), 'PUT', '/attendance/register', {
      date: MON2,
      periodId: s.p2,
      sectionId: s.xB,
      revision: null,
      marks: [
        { studentId: s.s1, status: 'A' },
        { studentId: s.s3, status: 'P' },
      ],
    });

    // Old register is unchanged and still X-A's.
    const old = await register(admin, MON1, s.p1, s.xA);
    expect(old.data.rows.find((r: any) => r.studentId === s.s1).status).toBe('P');

    // The student's attendance spans both classes: 1 P + 1 A = 50 %.
    const own = await ok(sessions.s1!, 'GET', `/attendance/me?from=2026-09-01&to=${MON2}`);
    expect(own.counts).toMatchObject({ P: 1, A: 1, percentage: 50 });
    const ownCells = own.days.flatMap((d: any) => Object.values(d.cells));
    // 7 Sep: X-A lesson not marked; 14 Sep: X-A maths P; 21 Sep: X-B science A (no X-A lesson).
    expect(own.days.map((d: any) => d.date).sort()).toEqual(['2026-09-07', MON1, MON2]);
    expect(ownCells.map((c: any) => `${c.subjectName}:${c.status}`).sort()).toEqual([
      'INT Maths:-',
      'INT Maths:P',
      'INT Science:A',
    ]);

    // The class totals stay with the class of the lesson.
    const sumA = await ok(
      admin,
      'GET',
      `/attendance/class-summary?sectionId=${s.xA}&from=2026-09-01&to=${MON2}`,
    );
    const rowA = sumA.students.find((r: any) => r.studentId === s.s1);
    expect(rowA.counts.P).toBe(1);
    expect(rowA.counts.A).toBe(0);
    const sumB = await ok(
      admin,
      'GET',
      `/attendance/class-summary?sectionId=${s.xB}&from=2026-09-01&to=${MON2}`,
    );
    const rowB = sumB.students.find((r: any) => r.studentId === s.s1);
    expect(rowB.counts.A).toBe(1);
    expect(rowB.counts.P).toBe(0);

    // The Term 1 result is the X-A result (rank among X-A, not X-B).
    const result = await ok(admin, 'GET', `/results/exams/${s.term1}/students/${s.s1}`);
    expect(result.section).toMatchObject({ sectionId: s.xA, sectionName: 'A' });
    expect(result.summary).toMatchObject({ total: 150, max: 200, percentage: 75, rank: 1 });
    const classB = await ok(admin, 'GET', `/results/exams/${s.term1}/sections/${s.xB}`);
    expect(JSON.stringify(classB)).not.toContain(s.s1);

    // The profile shows the new class with the old one in history.
    const profile = await ok(admin, 'GET', `/admin/students/${s.s1}`);
    expect(JSON.stringify(profile.currentPlacement ?? profile)).toContain(s.xB);
    const placements = profile.placements ?? profile.history ?? profile.enrolments;
    expect(placements).toHaveLength(2);

    // Reports read the same sources: the report card prints X-A; the class report Excel too.
    const card = await h.app.inject({
      method: 'GET',
      url: `/api/v1/reports/exam-card?examId=${s.term1}&studentId=${s.s1}&format=pdf`,
      headers: { cookie: admin.cookie },
    });
    expect(card.statusCode, card.body).toBe(200);
    const pdf = await inspectPdf(card.rawPayload);
    expect(pdf.text).toContain('Integration Student 1');
    expect(pdf.text).toContain('INT/1');
    expect(pdf.text).toMatch(/INT-X\s*-?\s*A/);
    expect(pdf.text).toContain('75%');

    const xlsx = await h.app.inject({
      method: 'GET',
      url: `/api/v1/reports/attendance/class?sectionId=${s.xB}&from=2026-09-01&to=${MON2}&format=xlsx`,
      headers: { cookie: admin.cookie },
    });
    expect(xlsx.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    const cells: string[] = [];
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        cells.push((row.values as unknown[]).map((v) => String(v ?? '')).join('|')),
      ),
    );
    // Lesson row: the roll number of the X-B placement (9), not the earlier X-A one.
    expect(cells).toContain(
      '|2026-09-21|Period 2|INT/1|9|Integration Student 1|INT-X|B|INT Science|Arun|A|Absent',
    );
    // Summary row in X-B: 0 P, 1 A, 0 %.
    expect(cells).toContain('|9|INT/1|Integration Student 1|0|1|0|0|0|0');
    expect(cells.join('\n')).not.toContain('Integration Student 2');
  });

  it('a later holiday freezes a saved register; removing it restores editing', async () => {
    const saved = await ok(arun(), 'PUT', '/attendance/register', {
      date: MON1,
      periodId: s.p1,
      sectionId: s.xA,
      revision: null,
      marks: [{ studentId: s.s1, status: 'P' }],
    });
    const calendar = await ok(admin, 'POST', `/admin/academic-years/${s.year}/calendar`, {
      date: MON1,
      status: 'HOLIDAY',
      scope: 'SECTIONS',
      classIds: [],
      sectionIds: [s.xA],
      reason: 'Integration holiday',
      note: null,
    });
    const entry = JSON.stringify(calendar).includes('Integration holiday')
      ? (calendar.entries as any[]).find((e) => e.reason === 'Integration holiday')
      : null;
    expect(entry).toBeTruthy();
    const frozen = await register(arun(), MON1, s.p1, s.xA);
    expect(frozen.status).toBe(200);
    expect(frozen.data.access.editable).toBe(false);
    expect(frozen.data.access.readOnlyReason).toMatch(/Integration holiday/);
    expect(frozen.data.access.readOnlyReason).toMatch(/kept as history/);
    expect(frozen.data.rows.find((r: any) => r.studentId === s.s1).status).toBe('P');
    const refused = await call(arun(), 'PUT', '/attendance/register', {
      date: MON1,
      periodId: s.p1,
      sectionId: s.xA,
      revision: saved.session?.revision ?? saved.revision,
      marks: [{ studentId: s.s1, status: 'A' }],
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    // Section B is untouched by a section-A holiday.
    expect((await register(arun(), MON1, s.p2, s.xB)).data.access.editable).toBe(true);
    // The teacher's lesson list no longer offers the X-A lesson that day.
    const lessons = await ok(arun(), 'GET', `/attendance/lessons?date=${MON1}`);
    expect(JSON.stringify(lessons)).toContain('INT Science');

    await ok(admin, 'DELETE', `/admin/calendar-entries/${entry.id}`);
    const again = await register(arun(), MON1, s.p1, s.xA);
    expect(again.data.access.editable).toBe(true);
    const fixed = await call(arun(), 'PUT', '/attendance/register', {
      date: MON1,
      periodId: s.p1,
      sectionId: s.xA,
      revision: again.data.session.revision,
      marks: [{ studentId: s.s1, status: 'A' }],
    });
    expect(fixed.status, fixed.raw).toBe(200);
  });

  it('marks → results: zero, decimals, normalisation, failure, ties, visibility and unlock', async () => {
    const s4 = await admit(4, s.xA, s.year);
    // Draft with a blank: nothing reaches the student.
    await sheet('maths', s.xA, { [s.s1]: 42.5, [s.s2]: 42.5, [s4]: null }, false);
    const draft = await ok(sessions.s1!, 'GET', `/results/me/exams/${s.term1}`);
    expect(draft.availableCount).toBe(0);
    expect(draft.summary).toBeNull();

    await sheet('maths', s.xA, { [s.s1]: 42.5, [s.s2]: 42.5, [s4]: 0 });
    const partial = await ok(sessions.s1!, 'GET', `/results/me/exams/${s.term1}`);
    const m = partial.subjects.find((x: any) => x.subjectName === 'INT Maths');
    expect(m).toMatchObject({ available: true, obtained: 42.5, normalized: 85, final: 85 });
    expect(partial).toMatchObject({ complete: false, availableCount: 1, summary: null });

    await sheet('science', s.xA, { [s.s1]: 70, [s.s2]: 70, [s4]: 10 });
    const view = await ok(admin, 'GET', `/results/exams/${s.term1}/sections/${s.xA}`);
    const byId = new Map<string, any>(
      (view.rows ?? view.students).map((r: any) => [r.studentId ?? r.student?.id, r]),
    );
    const rank = (id: string) => (byId.get(id).summary ?? byId.get(id)).rank;
    expect(rank(s.s1)).toBe(1);
    expect(rank(s.s2)).toBe(1); // tie shares the rank
    expect(rank(s4)).toBe(3); // competition ranking
    const fail = await ok(admin, 'GET', `/results/exams/${s.term1}/students/${s4}`);
    expect(fail.summary.result).toBe('FAIL');
    expect(fail.subjects.find((x: any) => x.subjectName === 'INT Maths').obtained).toBe(0);
    const pass = await ok(sessions.s1!, 'GET', `/results/me/exams/${s.term1}`);
    expect(pass.summary).toMatchObject({ total: 155, max: 200, percentage: 77.5, rank: 1 });

    // Unlock maths: it disappears for the student and the result becomes incomplete again.
    const locked = await ok(
      admin,
      'GET',
      `/marks/sheet?examSubjectId=${s.es.maths}&sectionId=${s.xA}`,
    );
    await ok(admin, 'POST', '/marks/sheet/unlock', {
      examSubjectId: s.es.maths,
      sectionId: s.xA,
      revision: locked.revision,
      reason: 'Integration correction',
    });
    const hidden = await ok(sessions.s1!, 'GET', `/results/me/exams/${s.term1}`);
    expect(hidden.complete).toBe(false);
    expect(hidden.summary).toBeNull();
    // Resubmit: back, with raw marks intact.
    const view2 = await ok(
      arun(),
      'GET',
      `/marks/sheet?examSubjectId=${s.es.maths}&sectionId=${s.xA}`,
    );
    await ok(arun(), 'POST', '/marks/sheet/submit', {
      examSubjectId: s.es.maths,
      sectionId: s.xA,
      revision: view2.revision,
    });
    const back = await ok(sessions.s1!, 'GET', `/results/me/exams/${s.term1}`);
    expect(back.summary).toMatchObject({ total: 155, percentage: 77.5 });
    // A student cannot read another student's result by id.
    expect(
      (await call(sessions.s1!, 'GET', `/results/exams/${s.term1}/students/${s.s2}`)).status,
    ).toBe(403);
  });

  it('class-teacher replacement and teacher deactivation move access, keep history', async () => {
    const range = `from=2026-09-01&to=${MON2}`;
    expect(
      (await call(kumar(), 'GET', `/reports/attendance/class?sectionId=${s.xA}&${range}`)).status,
    ).toBe(200);
    const board = await ok(admin, 'GET', `/admin/class-teachers?academicYearId=${s.year}`);
    const assignment = board.rows.find((r: any) => r.sectionId === s.xA).assignment;
    await ok(admin, 'POST', `/admin/class-teachers/${assignment.id}/end`, { endedOn: MON2 });
    await ok(admin, 'POST', '/admin/class-teachers', {
      academicYearId: s.year,
      sectionId: s.xA,
      teacherId: s.priya,
    });
    // Sessions pick up the new scope on their next request.
    expect(
      (await call(kumar(), 'GET', `/reports/attendance/class?sectionId=${s.xA}&${range}`)).status,
    ).toBe(403);
    expect(
      (await call(sessions.Priya!, 'GET', `/reports/attendance/class?sectionId=${s.xA}&${range}`))
        .status,
    ).toBe(200);

    // Deactivating Arun signs him out; the published timetable keeps his lessons as history.
    await ok(admin, 'POST', `/admin/teachers/${s.arun}/status`, {
      status: 'INACTIVE',
      note: 'Integration test',
    });
    expect((await call(arun(), 'GET', '/auth/me')).status).toBe(401);
    const week = await ok(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`);
    expect(JSON.stringify(week)).toContain('Arun');
  });

  it('after a class change, requests and announcements follow the placement of the time', async () => {
    await ok(admin, 'POST', '/admin/class-teachers', {
      academicYearId: s.year,
      sectionId: s.xB,
      teacherId: s.priya,
    });
    await sheet('maths', s.xA, { [s.s1]: 40, [s.s2]: 30 });
    await ok(admin, 'POST', `/admin/students/${s.s1}/transfer`, {
      targetSectionId: s.xB,
      rollNumber: '9',
      effectiveDate: '2026-09-16',
    });
    const s1 = sessions.s1!;
    // An attendance question about a lesson in X-A goes to X-A's class teacher.
    const att = await ok(s1, 'POST', '/requests', {
      type: 'ATTENDANCE_ISSUE',
      date: MON1,
      periodId: s.p1,
      description: 'I was present on the 14th.',
    });
    expect(att.request.assignedTo.name).toBe('Kumar');
    // A Term 1 result question goes to the class teacher of the class the exam was written in.
    const res = await ok(s1, 'POST', '/requests', {
      type: 'RESULT_CLARIFICATION',
      examId: s.term1,
      subjectId: s.maths,
      description: 'Please recheck my maths paper.',
    });
    expect(res.request.assignedTo.name).toBe('Kumar');
    // Profile corrections go to the office (no class teacher).
    const prof = await ok(s1, 'POST', '/requests', {
      type: 'PROFILE_CORRECTION',
      field: 'NAME',
      description: 'My name is spelt wrongly.',
    });
    expect(prof.request.assignedTo).toBeNull();
    // Kumar sees the two X-A questions, Priya (current class teacher) sees neither; Arun none.
    const inbox = async (who: Session) => JSON.stringify(await ok(who, 'GET', '/requests'));
    expect(await inbox(kumar())).toContain(att.request.id);
    expect(await inbox(kumar())).not.toContain(prof.request.id);
    expect(await inbox(sessions.Priya!)).not.toContain(att.request.id);
    expect((await call(arun(), 'GET', '/requests')).status).toBe(403);
    expect(await inbox(admin)).toContain(prof.request.id);

    // Section announcements follow the current placement.
    const post = async (who: Session, title: string, sectionId: string) =>
      ok(who, 'POST', '/announcements', {
        announcement: {
          title,
          body: 'Integration announcement.',
          audience: 'SECTION',
          classId: s.classX,
          sectionId,
          expiresOn: null,
        },
        publish: true,
      });
    await post(kumar(), 'For X-A', s.xA);
    await post(sessions.Priya!, 'For X-B', s.xB);
    expect(
      (
        await call(kumar(), 'POST', '/announcements', {
          announcement: {
            title: 'Not my class',
            body: 'x',
            audience: 'SECTION',
            classId: s.classX,
            sectionId: s.xB,
            expiresOn: null,
          },
          publish: true,
        })
      ).status,
    ).toBe(403);
    const feed = async (who: Session) =>
      JSON.stringify(await ok(who, 'GET', '/announcements/feed'));
    expect(await feed(s1)).toContain('For X-B');
    expect(await feed(s1)).not.toContain('For X-A');
    expect(await feed(sessions.s2!)).toContain('For X-A');
    expect(await feed(sessions.s2!)).not.toContain('For X-B');
    // Students cannot create announcements.
    expect((await call(s1, 'POST', '/announcements', {})).status).toBe(403);
    // Resolving a request never changes the record it is about.
    const before = await register(admin, MON1, s.p1, s.xA);
    await ok(kumar(), 'POST', `/requests/${att.request.id}/status`, {
      status: 'RESOLVED',
      revision: att.request.revision,
      note: 'Checked the register.',
    });
    const afterReg = await register(admin, MON1, s.p1, s.xA);
    expect(afterReg.data.rows).toEqual(before.data.rows);
  });

  it('optimistic concurrency: a stale attendance or marks save is refused with no partial write', async () => {
    const first = await ok(arun(), 'PUT', '/attendance/register', {
      date: MON2,
      periodId: s.p1,
      sectionId: s.xA,
      revision: null,
      marks: [
        { studentId: s.s1, status: 'P' },
        { studentId: s.s2, status: 'P' },
      ],
    });
    const rev = first.session.revision;
    await ok(kumar(), 'PUT', '/attendance/register', {
      date: MON2,
      periodId: s.p1,
      sectionId: s.xA,
      revision: rev,
      marks: [{ studentId: s.s2, status: 'A' }],
    });
    const stale = await call(arun(), 'PUT', '/attendance/register', {
      date: MON2,
      periodId: s.p1,
      sectionId: s.xA,
      revision: rev,
      marks: [
        { studentId: s.s1, status: 'A' },
        { studentId: s.s2, status: 'P' },
      ],
    });
    expect(stale.status).toBe(409);
    expect(stale.error.message).toMatch(/reload|changed|someone/i);
    const now = await register(admin, MON2, s.p1, s.xA);
    const status = (id: string) => now.data.rows.find((r: any) => r.studentId === id).status;
    expect([status(s.s1), status(s.s2)]).toEqual(['P', 'A']);

    const v = await ok(arun(), 'GET', `/marks/sheet?examSubjectId=${s.es.maths}&sectionId=${s.xA}`);
    await sheet('maths', s.xA, { [s.s1]: 10, [s.s2]: 10 }, false);
    const staleMarks = await call(arun(), 'PUT', '/marks/sheet', {
      examSubjectId: s.es.maths,
      sectionId: s.xA,
      revision: v.revision,
      marks: [{ studentId: s.s1, theory: 49, internal: null, practical: null }],
    });
    expect(staleMarks.status).toBe(409);
    const after = await ok(
      arun(),
      'GET',
      `/marks/sheet?examSubjectId=${s.es.maths}&sectionId=${s.xA}`,
    );
    expect(JSON.stringify(after)).not.toMatch(/"theory":49\b/);
    expect(JSON.stringify(after)).toMatch(/"theory":10\b/);
  });
});
