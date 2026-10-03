// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads untyped request bodies */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { admin, installFetch, renderApp, signedInAs, user } from './support/render-app';

/*
 * Exams, marks and results UI (Phase 8B). Network stubbed with synthetic TEST data; the real
 * rules are exercised by the API tests and the browser tests.
 */
const ok = (data: unknown) => ({ status: 200, body: { data } });
const ES = '00000000-0000-4000-8000-0000000000e1';
const SEC = '00000000-0000-4000-8000-0000000000a1';
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const EXAM = '00000000-0000-4000-8000-0000000000f1';
const SHEET_URL = `/marks/sheet?examSubjectId=${ES}&sectionId=${SEC}`;

const row = (id: string, roll: string, name: string, extra: object = {}) => ({
  studentId: id,
  enrolmentId: `e-${id}`,
  rollNumber: roll,
  admissionNumber: `ADM-${roll}`,
  fullName: name,
  onRoll: true,
  marks: { theory: null, internal: null, practical: null },
  complete: false,
  total: null,
  normalized: null,
  percent: null,
  grade: null,
  result: null,
  updatedAt: null,
  updatedBy: null,
  ...extra,
});

const sheet = (extra: object = {}) => ({
  examSubjectId: ES,
  sectionId: SEC,
  academicYear: { id: 'y1', label: 'TEST-2026', status: 'CURRENT' },
  exam: {
    id: EXAM,
    name: 'TEST Mid Term',
    stage: 'OPEN',
    status: 'ACTIVE',
    startDate: '2026-09-14',
    endDate: '2026-09-18',
  },
  section: { sectionId: SEC, sectionName: 'A', classId: 'c1', className: 'TEST-X' },
  subject: { id: 'sub1', name: 'TEST Science', code: null },
  structure: {
    components: [
      { key: 'theory', label: 'Theory', max: 80 },
      { key: 'practical', label: 'Practical', max: 20 },
    ],
    totalMax: 100,
    passMarks: 35,
    normalizedMax: null,
    includeInResult: true,
    gradeScale: {
      name: 'TEST scale',
      bands: [
        { label: 'A', minPercent: 80, maxPercent: 100 },
        { label: 'B', minPercent: 35, maxPercent: 80 },
        { label: 'C', minPercent: 0, maxPercent: 35 },
      ],
    },
  },
  teacher: { id: 't1', fullName: 'TEST Teacher', staffCode: 'T1' },
  status: 'DRAFT',
  revision: 3,
  submitted: null,
  unlocked: null,
  updatedAt: '2026-09-21T04:00:00.000Z',
  rows: [row(S1, '1', 'TEST Student One'), row(S2, '2', 'TEST Student Two')],
  counts: { entered: 0, total: 2 },
  access: { canEdit: true, canSubmit: true, canUnlock: false, readOnlyReason: null },
  ...extra,
});

const teacher = () =>
  user({ permissions: ['marks.view', 'marks.enter', 'marks.submit', 'exams.view'] });

describe('mark sheet', () => {
  it('blank stays "not entered", 0 counts, too-high marks are caught, Save sends only changes', async () => {
    const bodies: any[] = [];
    const { calls } = installFetch(
      signedInAs(teacher(), {
        'GET /marks/sheet': () => ok(sheet()),
        'PUT /marks/sheet': (init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return ok(
            sheet({
              revision: 4,
              rows: [
                row(S1, '1', 'TEST Student One', {
                  marks: { theory: 0, internal: null, practical: 0 },
                  complete: true,
                  total: 0,
                  grade: 'C',
                  result: 'FAIL',
                }),
                row(S2, '2', 'TEST Student Two'),
              ],
              counts: { entered: 1, total: 2 },
            }),
          );
        },
      }),
    );
    renderApp(SHEET_URL);
    const table = await screen.findByRole('table', { name: 'Marks' });
    expect(screen.getByText('0 / 2 students entered')).toBeInTheDocument();
    expect(screen.getByText('Theory 80 + Practical 20 = 100')).toBeInTheDocument();
    // Submit needs every mark.
    expect(screen.getByRole('button', { name: 'Submit marks' })).toBeDisabled();

    const theory1 = within(table).getByLabelText('Theory for TEST Student One (out of 80)');
    const practical1 = within(table).getByLabelText('Practical for TEST Student One (out of 20)');
    await userEvent.type(theory1, '0');
    await userEvent.type(practical1, '25');
    expect(within(table).getByText('At most 20')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Some marks are not valid/)).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith('PUT'))).toHaveLength(0);

    await userEvent.clear(practical1);
    await userEvent.type(practical1, '0');
    // Live preview: 0 + 0 → total 0, Fail (a real zero, not "not entered").
    expect(screen.getByText('1 / 2 students entered')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      examSubjectId: ES,
      sectionId: SEC,
      revision: 3,
      marks: [{ studentId: S1, theory: 0, internal: null, practical: 0 }],
    });
    expect(await screen.findByText('Draft saved · 1 / 2 students entered')).toBeInTheDocument();
  });

  it('Submit asks first; a locked sheet is read-only and the class teacher can unlock with a reason', async () => {
    const complete = [
      row(S1, '1', 'TEST Student One', {
        marks: { theory: 60, internal: null, practical: 18 },
        complete: true,
        total: 78,
        grade: 'B',
        result: 'PASS',
      }),
      row(S2, '2', 'TEST Student Two', {
        marks: { theory: 0, internal: null, practical: 0 },
        complete: true,
        total: 0,
        grade: 'C',
        result: 'FAIL',
      }),
    ];
    const bodies: Record<string, any> = {};
    installFetch(
      signedInAs(teacher(), {
        'GET /marks/sheet': () => ok(sheet({ rows: complete, counts: { entered: 2, total: 2 } })),
        'POST /marks/sheet/submit': (init) => {
          bodies.submit = JSON.parse(String(init?.body));
          return ok(
            sheet({
              status: 'SUBMITTED',
              revision: 5,
              rows: complete,
              counts: { entered: 2, total: 2 },
              submitted: { at: '2026-09-21T05:00:00.000Z', by: 'TEST Teacher' },
              access: {
                canEdit: false,
                canSubmit: false,
                canUnlock: true,
                readOnlyReason:
                  'Submitted and locked. An administrator or the class teacher can unlock it for correction.',
              },
            }),
          );
        },
        'POST /marks/sheet/unlock': (init) => {
          bodies.unlock = JSON.parse(String(init?.body));
          return ok(
            sheet({
              status: 'UNLOCKED',
              revision: 6,
              rows: complete,
              unlocked: {
                at: '2026-09-21T06:00:00.000Z',
                by: 'TEST CT',
                reason: 'Wrong mark for roll 2',
              },
            }),
          );
        },
      }),
    );
    renderApp(SHEET_URL);
    await screen.findByRole('table', { name: 'Marks' });
    await userEvent.click(screen.getByRole('button', { name: 'Submit marks' }));
    const confirm = await screen.findByRole('dialog', { name: 'Submit TEST Science marks?' });
    expect(confirm).toHaveTextContent('locked');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Submit and lock' }));
    await waitFor(() =>
      expect(bodies.submit).toEqual({ examSubjectId: ES, sectionId: SEC, revision: 3 }),
    );
    expect(await screen.findByText('Submitted · locked')).toBeInTheDocument();
    expect(screen.getByLabelText('Theory for TEST Student One (out of 80)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Unlock for correction' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Unlock these marks for correction?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    expect(within(dialog).getByText('Give a reason of at least 5 characters')).toBeInTheDocument();
    expect(bodies.unlock).toBeUndefined();
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Wrong mark for roll 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    await waitFor(() =>
      expect(bodies.unlock).toEqual({
        examSubjectId: ES,
        sectionId: SEC,
        revision: 5,
        reason: 'Wrong mark for roll 2',
      }),
    );
    expect(await screen.findByText(/“Wrong mark for roll 2”/)).toBeInTheDocument();
  });

  it('a stale save offers a reload', async () => {
    installFetch(
      signedInAs(teacher(), {
        'GET /marks/sheet': () => ok(sheet()),
        'PUT /marks/sheet': () => ({
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message:
                'These marks were changed by someone else after you opened them. Reload the sheet to see the latest marks, then make your change again.',
            },
          },
        }),
      }),
    );
    renderApp(SHEET_URL);
    const table = await screen.findByRole('table', { name: 'Marks' });
    await userEvent.type(
      within(table).getByLabelText('Theory for TEST Student Two (out of 80)'),
      '40',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Someone else changed these marks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload the sheet/ })).toBeInTheDocument();
  });
});

describe('results', () => {
  const result = (extra: object = {}) => ({
    academicYear: { id: 'y1', label: 'TEST-2026', status: 'CURRENT' },
    exam: {
      id: EXAM,
      name: 'TEST Mid Term',
      stage: 'OPEN',
      status: 'ACTIVE',
      startDate: null,
      endDate: null,
    },
    student: { id: S1, fullName: 'TEST Student One', admissionNumber: 'ADM-1', rollNumber: '1' },
    section: { sectionId: SEC, sectionName: 'A', classId: 'c1', className: 'TEST-X' },
    subjects: [
      {
        subjectId: 'm',
        subjectName: 'TEST Maths',
        countsInResult: true,
        available: true,
        components: [{ key: 'theory', label: 'Theory', max: 100, obtained: 84 }],
        totalMax: 100,
        obtained: 84,
        normalizedMax: null,
        normalized: null,
        finalMax: 100,
        final: 84,
        percent: 84,
        grade: 'A',
        result: 'PASS',
      },
      {
        subjectId: 'e',
        subjectName: 'TEST English',
        countsInResult: true,
        available: false,
        components: null,
        totalMax: 50,
        obtained: null,
        normalizedMax: 100,
        normalized: null,
        finalMax: 100,
        final: null,
        percent: null,
        grade: null,
        result: null,
      },
    ],
    complete: false,
    availableCount: 1,
    requiredCount: 2,
    summary: null,
    ...extra,
  });
  const student = () =>
    user({
      roles: ['STUDENT'],
      accountRole: 'STUDENT',
      teacherId: null,
      studentId: S1,
      permissions: ['results.view'],
    });
  const exams = {
    years: [{ id: 'y1', label: 'TEST-2026', status: 'CURRENT' }],
    academicYearId: 'y1',
    exams: [
      {
        id: EXAM,
        name: 'TEST Mid Term',
        stage: 'OPEN',
        status: 'ACTIVE',
        startDate: null,
        endDate: null,
      },
    ],
    sections: [],
  };

  it('a student sees finalised subjects, "not yet available" for the rest, and no total yet', async () => {
    installFetch(
      signedInAs(student(), {
        'GET /results/me': () => ok(exams),
        [`GET /results/me/exams/${EXAM}`]: () => ok(result()),
      }),
    );
    renderApp('/results');
    const table = await screen.findByRole('table', { name: 'Subject results' });
    expect(within(table).getByText('TEST Maths').closest('tr')).toHaveTextContent('84');
    expect(within(table).getByText('TEST English').closest('tr')).toHaveTextContent(
      'Not yet available',
    );
    expect(screen.getByText('Complete result not available yet')).toBeInTheDocument();
    expect(screen.queryByText('Rank')).not.toBeInTheDocument();
  });

  it('a complete result shows total, percentage, pass/fail in words and rank / ranked', async () => {
    installFetch(
      signedInAs(student(), {
        'GET /results/me': () => ok(exams),
        [`GET /results/me/exams/${EXAM}`]: () =>
          ok(
            result({
              complete: true,
              summary: {
                total: 247,
                max: 300,
                percentage: 82.33,
                result: 'PASS',
                rank: 4,
                rankedOf: 42,
                rankScope: 'SECTION',
              },
            }),
          ),
      }),
    );
    renderApp('/results');
    expect(await screen.findByText('247 / 300')).toBeInTheDocument();
    expect(screen.getByText('82.33%')).toBeInTheDocument();
    expect(screen.getByText('4 / 42')).toBeInTheDocument();
    expect(screen.getAllByText('Pass').length).toBeGreaterThan(0);
  });

  it('plain teachers get no Results page', async () => {
    installFetch(signedInAs(teacher()));
    renderApp('/results');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});

describe('exam administration', () => {
  const examView = {
    id: EXAM,
    academicYearId: 'y1',
    name: 'TEST Mid Term',
    startDate: '2026-09-14',
    endDate: '2026-09-18',
    weightagePercent: 0,
    gradeSchemeId: null,
    rankScope: 'SECTION',
    displayOrder: 1,
    status: 'ACTIVE',
    stage: 'DRAFT',
    description: null,
    subjectCount: 1,
  };
  const matrix = (teacherId: string | null, stage = 'DRAFT') => ({
    exam: { ...examView, stage, description: null },
    academicYear: { id: 'y1', label: 'TEST-2026', status: 'CURRENT' },
    rows: [
      {
        examSubjectId: ES,
        classId: 'c1',
        className: 'TEST-X',
        sectionId: SEC,
        sectionName: 'A',
        subjectId: 'sub1',
        subjectName: 'TEST Science',
        structure: sheet().structure,
        teacher: teacherId ? { id: teacherId, fullName: 'TEST Priya', staffCode: 'T2' } : null,
        teacherProblem: null,
        status: teacherId ? 'DRAFT' : null,
        entered: 0,
      },
    ],
    teachersBySubject: { sub1: [{ id: 't2', fullName: 'TEST Priya', staffCode: 'T2' }] },
    calendarNotes: ['2026-09-14 is not a working day for any class in the academic calendar.'],
    counts: { sheets: 1, submitted: 0, withoutTeacher: teacherId ? 0 : 1 },
  });

  it('assigns the teacher who enters marks and opens the exam after confirming', async () => {
    const bodies: any[] = [];
    installFetch(
      signedInAs(admin(), {
        [`GET /admin/exams/${EXAM}`]: () => ok(examView),
        'GET /admin/classes': () =>
          ok([
            {
              id: 'c1',
              name: 'TEST-X',
              displayOrder: 1,
              status: 'ACTIVE',
              sections: [],
              inUse: true,
            },
          ]),
        'GET /admin/subjects': () => ok([]),
        'GET /admin/grade-scales': () => ok([]),
        [`GET /admin/exams/${EXAM}/classes/c1/subjects`]: () => ok([]),
        [`GET /admin/exams/${EXAM}/mark-sheets`]: () => ok(matrix(null)),
        [`PUT /admin/exam-subjects/${ES}/sections/${SEC}/teacher`]: (init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return ok(matrix('t2'));
        },
        [`PUT /admin/exams/${EXAM}/stage`]: (init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return ok(matrix('t2', 'OPEN'));
        },
      }),
    );
    renderApp(`/admin/exams/${EXAM}`);
    expect(await screen.findByText(/not a working day for any class/)).toBeInTheDocument();
    const select = await screen.findByLabelText(
      'Teacher who enters TEST Science marks for TEST-X A',
    );
    await userEvent.selectOptions(select, 't2');
    await waitFor(() => expect(bodies).toEqual([{ teacherId: 't2' }]));
    expect(
      await screen.findByText('TEST Priya can enter TEST Science marks for TEST-X A'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open for marks' }));
    const confirm = await screen.findByRole('dialog', { name: 'Open for marks: TEST Mid Term?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Open for marks' }));
    await waitFor(() => expect(bodies[1]).toEqual({ stage: 'OPEN' }));
  });
});
