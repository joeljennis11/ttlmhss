/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions read untyped JSON response bodies */
import { randomUUID } from 'node:crypto';
import type { TimetableOperation, Weekday } from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '../src/core/auth/role-permissions.js';
import type { DataStore, Repositories } from '../src/data/data-store.js';
import type { Database } from '../src/data/kysely/database-schema.js';
import { adminSession, call, sessionFor, type Session } from './support/api-helpers.js';
import {
  assignClassTeacher,
  enrol,
  linkStudent,
  linkTeacher,
  seedAccount,
} from './support/auth-fixtures.js';
import {
  buildTestApp,
  openTestDatabase,
  type TestApp,
  type TestDriver,
} from './support/test-harness.js';

/*
 * Phase 6 — Timetable. TEST DATA ONLY: every name below is synthetic and lives in a throwaway
 * in-memory database. The school is built through the real admin APIs where they exist.
 */

interface School {
  year: string;
  pastYear: string;
  nextYear: string;
  /** Lesson periods 1–4 and the break, by label. */
  p: Record<'P1' | 'P2' | 'P3' | 'P4' | 'BREAK', string>;
  nextYearPeriod: string;
  xA: string;
  xB: string;
  ixA: string;
  inactiveSection: string;
  maths: string;
  physics: string;
  english: string;
  oldSubject: string;
  arun: string;
  priya: string;
  kumar: string;
  retired: string;
  studentId: string;
  otherStudentId: string;
}

async function setupSchool(
  h: TestApp,
  admin: Session,
  db: Kysely<Database> = h.db,
): Promise<School> {
  const ok = async (method: string, url: string, body?: unknown) => {
    const r = await call(admin, method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${r.raw}`);
    return r.data;
  };
  const past = await ok('POST', '/admin/academic-years', {
    label: 'TT-2025',
    startDate: '2025-06-01',
    endDate: '2026-04-30',
  });
  const year = await ok('POST', '/admin/academic-years', {
    label: 'TT-2026',
    startDate: '2026-05-15',
    endDate: '2027-04-30',
  });
  const next = await ok('POST', '/admin/academic-years', {
    label: 'TT-2027',
    startDate: '2027-06-01',
    endDate: '2028-04-30',
  });
  await ok('POST', `/admin/academic-years/${past.id}/make-current`);
  await ok('POST', `/admin/academic-years/${year.id}/make-current`); // past → CLOSED
  for (const y of [year.id, past.id, next.id]) {
    await ok('PUT', `/admin/academic-years/${y}/working-days`, {
      workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    });
  }
  const slot = (y: string, kind: string, label: string, n: number | null, s: string, e: string) =>
    ok('POST', `/admin/academic-years/${y}/periods`, {
      kind,
      label,
      periodNumber: n,
      startTime: s,
      endTime: e,
    });
  await slot(year.id, 'LESSON', 'Period 1', 1, '08:00', '08:45');
  await slot(year.id, 'LESSON', 'Period 2', 2, '08:45', '09:30');
  await slot(year.id, 'BREAK', 'Morning break', null, '09:30', '09:45');
  await slot(year.id, 'LESSON', 'Period 3', 3, '09:45', '10:30');
  const day = await slot(year.id, 'LESSON', 'Period 4', 4, '10:30', '11:15');
  const byLabel = (label: string) => day.slots.find((x: any) => x.label === label).id;
  const nextDay = await slot(next.id, 'LESSON', 'Period 1', 1, '08:00', '08:45');

  const x = await ok('POST', '/admin/classes', { name: 'TT-X', displayOrder: 10 });
  await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'A' });
  await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'B' });
  const xc = await ok('POST', `/admin/classes/${x.id}/sections`, { name: 'Z' });
  const inactiveSection = xc.sections.find((s: any) => s.name === 'Z').id;
  await ok('PATCH', `/admin/sections/${inactiveSection}`, { status: 'INACTIVE' });
  const ix = await ok('POST', '/admin/classes', { name: 'TT-IX', displayOrder: 9 });
  const ixc = await ok('POST', `/admin/classes/${ix.id}/sections`, { name: 'A' });

  const subject = (name: string, code: string, order: number) =>
    ok('POST', '/admin/subjects', { name, code, displayOrder: order });
  const maths = await subject('TT Maths', 'TMA', 1);
  const physics = await subject('TT Physics', 'TPH', 2);
  const english = await subject('TT English', 'TEN', 3);
  const old = await subject('TT Old', 'TOL', 4);

  const teacher = async (username: string, name: string, subjects: string[]) => {
    const userId = await seedAccount(h.deps, { username, role: 'TEACHER' });
    const id = await linkTeacher(db, userId, name);
    for (const subjectId of subjects) {
      await ok('POST', `/admin/teachers/${id}/subjects`, { subjectId });
    }
    return id;
  };
  const arun = await teacher('tt.arun', 'TT Arun', [maths.id, physics.id]);
  const priya = await teacher('tt.priya', 'TT Priya', [physics.id, english.id]);
  const kumar = await teacher('tt.kumar', 'TT Kumar', [english.id, old.id]);
  const retired = await teacher('tt.retired', 'TT Retired', [maths.id]);
  await ok('PATCH', `/admin/subjects/${old.id}`, { status: 'INACTIVE' });
  await db.updateTable('teachers').set({ status: 'INACTIVE' }).where('id', '=', retired).execute();

  const sections = (await ok('GET', '/admin/classes')) as any[];
  const xRow = sections.find((c: any) => c.name === 'TT-X');
  const sectionId = (name: string) => xRow.sections.find((s: any) => s.name === name).id;

  // Kumar is class teacher of X-A in the current year.
  await assignClassTeacher(db, kumar, year.id, sectionId('A'));

  const student = async (username: string, sectionIdValue: string) => {
    const userId = await seedAccount(h.deps, { username, role: 'STUDENT' });
    const id = await linkStudent(db, userId, `TT ${username}`);
    await enrol(db, id, year.id, sectionIdValue);
    return id;
  };
  const studentId = await student('tt.student', sectionId('A'));
  const otherStudentId = await student('tt.other', sectionId('B'));

  return {
    year: year.id,
    pastYear: past.id,
    nextYear: next.id,
    p: {
      P1: byLabel('Period 1'),
      P2: byLabel('Period 2'),
      P3: byLabel('Period 3'),
      P4: byLabel('Period 4'),
      BREAK: byLabel('Morning break'),
    },
    nextYearPeriod: nextDay.slots[0].id,
    xA: sectionId('A'),
    xB: sectionId('B'),
    ixA: ixc.sections[0].id,
    inactiveSection,
    maths: maths.id,
    physics: physics.id,
    english: english.id,
    oldSubject: old.id,
    arun,
    priya,
    kumar,
    retired,
    studentId,
    otherStudentId,
  };
}

const create = (
  sectionId: string,
  day: Weekday,
  periodId: string,
  subjectId: string,
  teacherId: string,
): TimetableOperation & { id: string } => ({
  op: 'create',
  id: randomUUID(),
  day,
  periodId,
  sectionId,
  subjectId,
  teacherId,
});

const changes = (
  s: Session,
  school: School,
  sectionId: string,
  operations: unknown[],
  dryRun = false,
) =>
  call(s, 'POST', `/timetable/years/${school.year}/draft/changes`, {
    sectionId,
    operations,
    dryRun,
  });

const startDraft = (s: Session, school: School, yearId = school.year) =>
  call(s, 'POST', `/timetable/years/${yearId}/draft`);

const publish = (s: Session, school: School) =>
  call(s, 'POST', `/timetable/years/${school.year}/draft/publish`);

// ---------------------------------------------------------------------------
// Workflow, views and audit — both providers
// ---------------------------------------------------------------------------

describe.each<TestDriver>(['sqlite', 'postgres'])('timetable (%s)', (driver) => {
  let h: TestApp;
  let db: Kysely<Database>;
  let admin: Session;
  let s: School;

  beforeEach(async () => {
    const opened = await openTestDatabase(driver);
    db = opened.db;
    h = await buildTestApp({ dataStore: opened.store });
    admin = await adminSession(h);
    s = await setupSchool(h, admin, db);
  }, 120_000);
  afterEach(async () => {
    await h.close();
  });

  it('draft → several saves → publish; views come only from the published version', async () => {
    // Before anything: the configured week frame, no versions.
    const empty = await call(admin, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`);
    expect(empty.status).toBe(200);
    expect(empty.data).toMatchObject({ draft: null, published: null, entries: [], issues: [] });
    expect(empty.data.workingDays).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI']);
    expect(empty.data.periods.map((p: any) => [p.label, p.kind])).toEqual([
      ['Period 1', 'LESSON'],
      ['Period 2', 'LESSON'],
      ['Morning break', 'BREAK'],
      ['Period 3', 'LESSON'],
      ['Period 4', 'LESSON'],
    ]);

    // No direct edits without a draft.
    const noDraft = await changes(admin, s, s.xA, [create(s.xA, 'MON', s.p.P3, s.maths, s.arun)]);
    expect(noDraft.status).toBe(409);
    expect(noDraft.error.message).toMatch(/Start a draft/);

    const draft = await startDraft(admin, s);
    expect(draft.status).toBe(201);
    expect(draft.data).toMatchObject({
      status: 'DRAFT',
      versionNumber: 1,
      entryCount: 0,
      createdBy: 'test.admin',
      publishedAt: null,
    });
    expect((await startDraft(admin, s)).status).toBe(409);

    // Save 1: four lessons (the same teacher + subject in two classes is fine).
    const maths10A = create(s.xA, 'MON', s.p.P3, s.maths, s.arun);
    const physics10A = create(s.xA, 'MON', s.p.P4, s.physics, s.priya);
    const maths10B = create(s.xB, 'TUE', s.p.P2, s.maths, s.arun);
    const english10A = create(s.xA, 'WED', s.p.P1, s.english, s.kumar);
    const save1 = await changes(admin, s, s.xA, [maths10A, physics10A, maths10B, english10A]);
    expect(save1.status).toBe(200);
    expect(save1.data.entries).toHaveLength(3); // the X-A view
    expect(save1.data.entries[0]).toMatchObject({
      day: 'MON',
      periodId: s.p.P3,
      className: 'TT-X',
      sectionName: 'A',
      subjectName: 'TT Maths',
      teacherName: 'TT Arun',
    });

    // Save 2: move, edit and remove in one batch.
    const save2 = await changes(admin, s, s.xB, [
      { op: 'move', entryId: maths10B.id, day: 'TUE', periodId: s.p.P4 },
      { op: 'update', entryId: physics10A.id, subjectId: s.english, teacherId: s.priya },
      { op: 'remove', entryId: english10A.id },
    ]);
    expect(save2.status).toBe(200);
    expect(save2.data.entries).toEqual([
      expect.objectContaining({ id: maths10B.id, day: 'TUE', periodId: s.p.P4 }),
    ]);

    // Nothing is live yet.
    const before = await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`);
    expect(before.data).toMatchObject({ published: null, entries: [] });

    const pub = await publish(admin, s);
    expect(pub.status).toBe(200);
    expect(pub.data).toMatchObject({
      status: 'PUBLISHED',
      versionNumber: 1,
      entryCount: 3,
      publishedBy: 'test.admin',
    });
    expect(pub.data.publishedAt).toBeTruthy();

    // Class view.
    const classView = await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`);
    expect(classView.data.entries.map((e: any) => [e.day, e.periodId, e.subjectName])).toEqual([
      ['MON', s.p.P3, 'TT Maths'],
      ['MON', s.p.P4, 'TT English'],
    ]);
    // Teacher view: Arun across both sections.
    const arun = await sessionFor(h, 'tt.arun');
    const mine = await call(arun, 'GET', '/timetable/me');
    expect(mine.status).toBe(200);
    expect(mine.data.teacher.fullName).toBe('TT Arun');
    expect(mine.data.entries.map((e: any) => `${e.day} ${e.className}-${e.sectionName}`)).toEqual([
      'MON TT-X-A',
      'TUE TT-X-B',
    ]);
    // Student timetable foundation: current placement → section → published timetable.
    const studentView = await call(admin, 'GET', `/timetable/students/${s.studentId}`);
    expect(studentView.data.placement).toMatchObject({ sectionId: s.xA, className: 'TT-X' });
    expect(studentView.data.timetable.entries).toHaveLength(2);
    // Phase 7 foundation: Monday's lessons with full context.
    const lessons = await call(arun, 'GET', '/timetable/lessons?date=2026-06-01');
    expect(lessons.data).toMatchObject({ day: 'MON', schoolDay: true });
    expect(lessons.data.lessons).toHaveLength(1);
    expect(lessons.data.lessons[0]).toMatchObject({
      date: '2026-06-01',
      period: { id: s.p.P3, label: 'Period 3' },
      entry: { sectionId: s.xA, subjectId: s.maths, teacherId: s.arun },
      versionId: pub.data.id,
    });
    const saturday = await call(arun, 'GET', '/timetable/lessons?date=2026-06-06');
    expect(saturday.data).toMatchObject({ schoolDay: false, lessons: [] });

    // Audit trail.
    const audit = await db.selectFrom('audit_logs').selectAll().execute();
    const actions = audit.map((a) => a.action);
    for (const action of [
      'timetable.draft_created',
      'timetable.entry_created',
      'timetable.entry_moved',
      'timetable.entry_updated',
      'timetable.entry_removed',
      'timetable.draft_saved',
      'timetable.published',
    ]) {
      expect(actions).toContain(action);
    }
    const moved = audit.find((a) => a.action === 'timetable.entry_moved')!;
    expect(JSON.parse(moved.before_json!)).toMatchObject({
      day: 'TUE',
      period: 'Period 2',
      classSection: 'TT-X B',
      subject: 'TT Maths',
      teacher: 'TT Arun',
      academicYear: 'TT-2026',
    });
    expect(JSON.parse(moved.after_json!)).toMatchObject({ day: 'TUE', period: 'Period 4' });
    expect(moved.actor_user_id).toBeTruthy();

    // A second round: the new draft copies the live timetable; publishing supersedes v1, which
    // keeps its lessons as history.
    const v2 = await startDraft(admin, s);
    expect(v2.data).toMatchObject({ versionNumber: 2, entryCount: 3 });
    const editor = await call(admin, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`);
    const copiedMaths = editor.data.entries.find((e: any) => e.subjectName === 'TT Maths');
    expect(copiedMaths.id).not.toBe(maths10A.id);
    await changes(admin, s, s.xA, [{ op: 'remove', entryId: copiedMaths.id }]);
    // The live timetable is untouched while the draft changes.
    const stillLive = await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`);
    expect(stillLive.data.entries).toHaveLength(2);
    expect((await publish(admin, s)).status).toBe(200);
    const versions = await call(admin, 'GET', `/timetable/years/${s.year}/versions`);
    expect(versions.data.items.map((v: any) => [v.versionNumber, v.status, v.entryCount])).toEqual([
      [2, 'PUBLISHED', 2],
      [1, 'SUPERSEDED', 3],
    ]);
    expect(versions.data.items[1].supersededAt).toBeTruthy();
    const after = await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`);
    expect(after.data.entries.map((e: any) => e.subjectName)).toEqual(['TT English']);
  });

  it('rejects invalid lessons with clear messages (server-side validation)', async () => {
    await startDraft(admin, s);
    const reject = async (op: unknown, pattern: RegExp, status = 409) => {
      const res = await changes(admin, s, s.xA, [op]);
      expect(res.status, JSON.stringify(res.error)).toBe(status);
      expect(res.error.message).toMatch(pattern);
      return res;
    };
    // C — the teacher is not assigned that subject.
    const notAssigned = await reject(
      create(s.xA, 'MON', s.p.P1, s.maths, s.kumar),
      /TT Kumar is not assigned TT Maths/,
    );
    expect(notAssigned.error.details[0].path).toBe('body.operations.0.teacherId');
    // E — inactive subject (even though Kumar was assigned it while it was active).
    await reject(create(s.xA, 'MON', s.p.P1, s.oldSubject, s.kumar), /TT Old is inactive/);
    // F — inactive teacher.
    await reject(create(s.xA, 'MON', s.p.P1, s.maths, s.retired), /TT Retired is inactive/);
    // Unknown teacher / subject.
    await reject(create(s.xA, 'MON', s.p.P1, s.maths, randomUUID()), /teacher was not found/);
    await reject(create(s.xA, 'MON', s.p.P1, randomUUID(), s.arun), /subject was not found/);
    // D — invalid class/section.
    await reject(create(s.inactiveSection, 'MON', s.p.P1, s.maths, s.arun), /inactive/);
    await reject(create(randomUUID(), 'MON', s.p.P1, s.maths, s.arun), /not found/, 404);
    // Breaks, other years' periods, unknown periods, non-working days.
    await reject(create(s.xA, 'MON', s.p.BREAK, s.maths, s.arun), /is a break/);
    await reject(create(s.xA, 'MON', s.nextYearPeriod, s.maths, s.arun), /not part of the TT-2026/);
    await reject(create(s.xA, 'MON', randomUUID(), s.maths, s.arun), /not part of the TT-2026/);
    await reject(create(s.xA, 'SAT', s.p.P1, s.maths, s.arun), /Saturday is not a working day/);
    // Malformed input never reaches the service.
    const bad = await changes(admin, s, s.xA, [{ op: 'create', id: 'x', day: 'FUNDAY' }]);
    expect(bad.status).toBe(400);

    // Valid, then conflicts A and B.
    const first = create(s.xA, 'MON', s.p.P3, s.maths, s.arun);
    expect((await changes(admin, s, s.xA, [first])).status).toBe(200);
    await reject(
      create(s.xB, 'MON', s.p.P3, s.physics, s.arun),
      /TT Arun already teaches TT-X A \(TT Maths\) on Monday, Period 3/,
    );
    await reject(
      create(s.xA, 'MON', s.p.P3, s.english, s.priya),
      /TT-X A already has TT Maths \(TT Arun\) on Monday, Period 3/,
    );
    // Unrelated teacher and class in the same slot succeed.
    const other = create(s.xB, 'MON', s.p.P3, s.english, s.priya);
    expect((await changes(admin, s, s.xB, [other])).status).toBe(200);
    // Editing a lesson's teacher into a clash is rejected too.
    await reject(
      { op: 'update', entryId: other.id, subjectId: s.maths, teacherId: s.arun },
      /TT Arun already teaches/,
    );

    // Moving into a conflict is rejected and the original stays where it was.
    const p4 = create(s.xA, 'MON', s.p.P4, s.physics, s.priya);
    expect((await changes(admin, s, s.xA, [p4])).status).toBe(200);
    await reject({ op: 'move', entryId: p4.id, day: 'MON', periodId: s.p.P3 }, /already has/);
    await reject({ op: 'move', entryId: p4.id, day: 'MON', periodId: s.p.BREAK }, /is a break/);
    const view = await call(admin, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`);
    expect(view.data.entries.find((e: any) => e.id === p4.id).periodId).toBe(s.p.P4);

    // A batch is all-or-nothing: the valid first change is not kept when the second fails.
    const good = create(s.xA, 'TUE', s.p.P1, s.maths, s.arun);
    const res = await changes(admin, s, s.xA, [
      good,
      create(s.xA, 'TUE', s.p.P2, s.maths, s.kumar),
    ]);
    expect(res.status).toBe(409);
    expect(res.error.details[0].path).toBe('body.operations.1.teacherId');
    const afterBatch = await call(
      admin,
      'GET',
      `/timetable/years/${s.year}/editor?sectionId=${s.xA}`,
    );
    expect(afterBatch.data.entries.some((e: any) => e.id === good.id)).toBe(false);

    // A dry run validates and shows the result, but stores nothing.
    const dry = await changes(admin, s, s.xA, [good], true);
    expect(dry.status).toBe(200);
    expect(dry.data.entries.some((e: any) => e.id === good.id)).toBe(true);
    const afterDry = await call(
      admin,
      'GET',
      `/timetable/years/${s.year}/editor?sectionId=${s.xA}`,
    );
    expect(afterDry.data.entries.some((e: any) => e.id === good.id)).toBe(false);
  });

  it('publish validates the whole draft; a failed publish leaves the live timetable unchanged', async () => {
    await startDraft(admin, s);
    expect((await publish(admin, s)).error.message).toMatch(/no lessons/);
    const lesson = create(s.xA, 'MON', s.p.P1, s.english, s.kumar);
    await changes(admin, s, s.xA, [lesson]);
    expect((await publish(admin, s)).status).toBe(200);

    // Next draft: something becomes invalid after it was added.
    await startDraft(admin, s);
    await changes(admin, s, s.xA, [create(s.xA, 'TUE', s.p.P1, s.english, s.priya)]);
    await call(admin, 'PATCH', `/admin/periods/${s.p.P1}`, { status: 'INACTIVE' });
    const editor = await call(admin, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`);
    expect(editor.data.issues.length).toBe(2);
    // The inactive period still appears in the grid (marked inactive) so nothing disappears.
    expect(editor.data.periods.find((p: any) => p.id === s.p.P1).status).toBe('INACTIVE');
    const failed = await publish(admin, s);
    expect(failed.status).toBe(409);
    expect(failed.error.message).toMatch(/not published: 2 lessons need attention/);
    expect(failed.error.details.map((d: any) => d.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/TT-X A, Monday, Period 1: Period 1 is inactive/),
      ]),
    );
    const versions = await call(admin, 'GET', `/timetable/years/${s.year}/versions`);
    expect(versions.data.items.map((v: any) => v.status)).toEqual(['DRAFT', 'PUBLISHED']);
    const live = await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`);
    expect(live.data.entries).toHaveLength(1);
    expect(live.data.published.versionNumber).toBe(1);

    // Discarding the draft is audited and leaves the published version alone.
    expect((await call(admin, 'DELETE', `/timetable/years/${s.year}/draft`)).status).toBe(200);
    const afterDiscard = await call(admin, 'GET', `/timetable/years/${s.year}/versions`);
    expect(afterDiscard.data.items.map((v: any) => v.status)).toEqual(['PUBLISHED']);
    const discarded = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'timetable.draft_discarded')
      .executeTakeFirstOrThrow();
    expect(JSON.parse(discarded.before_json!).lessons).toHaveLength(2);
  });

  it('protects history: closed years, periods and Teacher → Subject pairs in use', async () => {
    const closed = await startDraft(admin, s, s.pastYear);
    expect(closed.status).toBe(409);
    expect(closed.error.message).toMatch(/closed/);

    await startDraft(admin, s);
    await changes(admin, s, s.xA, [create(s.xA, 'MON', s.p.P3, s.maths, s.arun)]);
    const removePair = await call(admin, 'DELETE', `/admin/teachers/${s.arun}/subjects/${s.maths}`);
    expect(removePair.status).toBe(409);
    expect(removePair.error.message).toMatch(/in the timetable/);
    // An unused pair can still be removed (Phase 5 behaviour unchanged).
    expect(
      (await call(admin, 'DELETE', `/admin/teachers/${s.arun}/subjects/${s.physics}`)).status,
    ).toBe(200);
    const removePeriod = await call(admin, 'DELETE', `/admin/periods/${s.p.P3}`);
    expect(removePeriod.status).toBe(409);
    expect(removePeriod.error.message).toMatch(/used by a timetable/);
    expect((await call(admin, 'DELETE', `/admin/periods/${s.p.P2}`)).status).toBe(200);
    // Years are separate: the next year's timetable is independent.
    const nextDraft = await startDraft(admin, s, s.nextYear);
    expect(nextDraft.data.versionNumber).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Permissions and scope
// ---------------------------------------------------------------------------

describe('timetable permissions and scope', () => {
  let h: TestApp;
  let admin: Session;
  let s: School;

  beforeEach(async () => {
    h = await buildTestApp();
    admin = await adminSession(h);
    s = await setupSchool(h, admin);
  }, 60_000);
  afterEach(async () => {
    await h.close();
  });

  const grantClassTeacherEditing = async () => {
    const res = await call(admin, 'PUT', '/admin/permissions/CLASS_TEACHER', {
      permissions: [...ROLE_PERMISSIONS.CLASS_TEACHER, 'timetable.manage'],
    });
    expect(res.status).toBe(200);
  };

  it('requires sign-in, and teachers cannot edit or publish', async () => {
    const anon = await h.app.inject({ method: 'GET', url: `/api/v1/timetable/me` });
    expect(anon.statusCode).toBe(401);
    const arun = await sessionFor(h, 'tt.arun');
    expect((await startDraft(arun, s)).status).toBe(403);
    expect(
      (await call(arun, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`)).status,
    ).toBe(403);
    expect(
      (await changes(arun, s, s.xA, [create(s.xA, 'MON', s.p.P1, s.maths, s.arun)])).status,
    ).toBe(403);
    expect((await publish(arun, s)).status).toBe(403);
    expect((await call(arun, 'DELETE', `/timetable/years/${s.year}/draft`)).status).toBe(403);
  });

  it('class teachers edit only their own class, and only when the administrator allows it', async () => {
    await startDraft(admin, s);
    const otherLesson = create(s.xB, 'MON', s.p.P1, s.maths, s.arun);
    await changes(admin, s, s.xB, [otherLesson]);
    const kumar = await sessionFor(h, 'tt.kumar');

    // Default (D-17): class teachers view; they do not edit.
    expect(
      (await call(kumar, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`)).status,
    ).toBe(403);

    await grantClassTeacherEditing();
    const own = await call(kumar, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xA}`);
    expect(own.status).toBe(200);
    expect(own.data.canPublish).toBe(false);
    const options = await call(kumar, 'GET', `/timetable/years/${s.year}/options`);
    expect(options.data.sections.map((x: any) => x.sectionId)).toEqual([s.xA]);

    expect(
      (await changes(kumar, s, s.xA, [create(s.xA, 'MON', s.p.P2, s.english, s.kumar)])).status,
    ).toBe(200);
    // Another class: not in scope, whatever the request says.
    expect(
      (await call(kumar, 'GET', `/timetable/years/${s.year}/editor?sectionId=${s.xB}`)).status,
    ).toBe(403);
    const intoB = await changes(kumar, s, s.xA, [create(s.xB, 'TUE', s.p.P2, s.english, s.kumar)]);
    expect(intoB.status).toBe(403);
    expect(intoB.error.message).toMatch(/TT-X B is not your class/);
    expect(
      (await changes(kumar, s, s.xA, [{ op: 'remove', entryId: otherLesson.id }])).status,
    ).toBe(403);
    expect(
      (
        await changes(kumar, s, s.xA, [
          { op: 'move', entryId: otherLesson.id, day: 'TUE', periodId: s.p.P1 },
        ])
      ).status,
    ).toBe(403);
    // Publishing stays with administrators, and cannot be granted to a class teacher.
    expect((await publish(kumar, s)).status).toBe(403);
    const widen = await call(admin, 'PUT', '/admin/permissions/CLASS_TEACHER', {
      permissions: [...ROLE_PERMISSIONS.CLASS_TEACHER, 'timetable.manage', 'timetable.publish'],
    });
    expect(widen.status).toBeGreaterThanOrEqual(400);
    // A plain teacher can never be granted editing (ceiling: class teachers only).
    const teacherWiden = await call(admin, 'PUT', '/admin/permissions/TEACHER', {
      permissions: [...ROLE_PERMISSIONS.TEACHER, 'timetable.manage'],
    });
    expect(teacherWiden.status).toBeGreaterThanOrEqual(400);
  });

  it('views are scoped to the caller', async () => {
    await startDraft(admin, s);
    await changes(admin, s, s.xB, [
      create(s.xB, 'MON', s.p.P1, s.maths, s.arun),
      create(s.xA, 'MON', s.p.P2, s.english, s.priya),
    ]);
    await publish(admin, s);
    const arun = await sessionFor(h, 'tt.arun');
    const kumar = await sessionFor(h, 'tt.kumar');
    const student = await sessionFor(h, 'tt.student');

    // Every staff member and student can list the years (the admin year list is admin-only).
    const years = await call(arun, 'GET', '/timetable/years');
    expect(years.status).toBe(200);
    expect(years.data.items.map((y: any) => y.label)).toEqual(['TT-2027', 'TT-2026', 'TT-2025']);
    expect((await call(arun, 'GET', '/admin/academic-years')).status).toBe(403);

    // Teachers: own timetable only; class timetables of sections they teach.
    expect((await call(arun, 'GET', `/timetable/years/${s.year}/teachers/${s.arun}`)).status).toBe(
      200,
    );
    expect((await call(arun, 'GET', `/timetable/years/${s.year}/teachers/${s.priya}`)).status).toBe(
      403,
    );
    expect((await call(arun, 'GET', `/timetable/years/${s.year}/sections/${s.xB}`)).status).toBe(
      200,
    );
    expect((await call(arun, 'GET', `/timetable/years/${s.year}/sections/${s.ixA}`)).status).toBe(
      403,
    );
    const arunSections = await call(arun, 'GET', `/timetable/years/${s.year}/sections`);
    expect(arunSections.data.items.map((x: any) => x.sectionId)).toEqual([s.xB]);
    expect(
      (await call(arun, 'GET', `/timetable/lessons?date=2026-06-01&teacherId=${s.priya}`)).status,
    ).toBe(403);

    // Class teacher: their class (even without teaching in it).
    expect((await call(kumar, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`)).status).toBe(
      200,
    );
    expect((await call(kumar, 'GET', `/timetable/years/${s.year}/sections/${s.xB}`)).status).toBe(
      403,
    );

    // Student: own placement only.
    const own = await call(student, 'GET', `/timetable/students/${s.studentId}`);
    expect(own.status).toBe(200);
    expect(own.data.timetable.entries).toHaveLength(1);
    expect((await call(student, 'GET', `/timetable/students/${s.otherStudentId}`)).status).toBe(
      403,
    );
    expect((await call(student, 'GET', `/timetable/years/${s.year}/sections/${s.xB}`)).status).toBe(
      403,
    );
    expect((await call(student, 'GET', '/timetable/me')).status).toBe(409);
    expect((await startDraft(student, s)).status).toBe(403);

    // Administrators: everything.
    expect((await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.ixA}`)).status).toBe(
      200,
    );
    expect(
      (await call(admin, 'GET', `/timetable/lessons?date=2026-06-01&teacherId=${s.arun}`)).data
        .lessons,
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Atomic publish: an unexpected failure part-way rolls everything back
// ---------------------------------------------------------------------------

/** Wraps a data store so `markPublished` fails inside transactions while `failing` is true. */
function failingPublishStore(store: DataStore) {
  const state = { failing: false };
  const wrap = (repos: Repositories): Repositories => ({
    ...repos,
    timetable: new Proxy(repos.timetable, {
      get(target, prop, receiver) {
        if (prop === 'markPublished' && state.failing) {
          return async () => {
            throw new Error('simulated storage failure');
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  });
  const wrapped: DataStore = {
    repositories: store.repositories,
    schema: store.schema,
    ping: () => store.ping(),
    close: () => store.close(),
    transaction: (work) => store.transaction((repos) => work(wrap(repos))),
  };
  return { wrapped, state };
}

describe('timetable publish atomicity', () => {
  it('a failure after the old version was superseded rolls the whole publish back', async () => {
    const opened = await openTestDatabase('sqlite');
    const { wrapped, state } = failingPublishStore(opened.store);
    const h = await buildTestApp({ dataStore: wrapped });
    try {
      const admin = await adminSession(h);
      const s = await setupSchool(h, admin, opened.db);
      await startDraft(admin, s);
      await changes(admin, s, s.xA, [create(s.xA, 'MON', s.p.P1, s.maths, s.arun)]);
      expect((await publish(admin, s)).status).toBe(200);
      await startDraft(admin, s);
      await changes(admin, s, s.xA, [create(s.xA, 'TUE', s.p.P1, s.maths, s.arun)]);

      state.failing = true;
      const failed = await publish(admin, s);
      expect(failed.status).toBe(500);
      expect(failed.raw).not.toMatch(/simulated storage failure/);
      state.failing = false;

      const versions = await call(admin, 'GET', `/timetable/years/${s.year}/versions`);
      expect(versions.data.items.map((v: any) => [v.versionNumber, v.status])).toEqual([
        [2, 'DRAFT'],
        [1, 'PUBLISHED'],
      ]);
      const live = await call(admin, 'GET', `/timetable/years/${s.year}/sections/${s.xA}`);
      expect(live.data.entries.map((e: any) => e.day)).toEqual(['MON']);
      const published = await opened.db
        .selectFrom('audit_logs')
        .select('action')
        .where('action', '=', 'timetable.published')
        .execute();
      expect(published).toHaveLength(1);
      // And it succeeds once the fault is gone.
      expect((await publish(admin, s)).status).toBe(200);
    } finally {
      await h.close();
    }
  }, 60_000);
});
