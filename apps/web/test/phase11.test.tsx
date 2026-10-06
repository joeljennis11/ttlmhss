// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads untyped request bodies */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { admin, installFetch, renderApp, signedInAs, user } from './support/render-app';

/* Phase 11 UI: reports hub, annual report page, the student's own reports. Synthetic TEST data. */
const ok = (data: unknown, status = 200) => ({ status, body: { data } });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const YEAR = {
  id: uuid(1),
  label: 'TEST-2026',
  status: 'CURRENT',
  startDate: '2026-06-01',
  endDate: '2027-03-31',
};
const SEC = uuid(2);
const section = { sectionId: SEC, sectionName: 'A', classId: uuid(3), className: 'TEST-X' };
const exam = {
  id: uuid(4),
  name: 'TEST Term 1',
  stage: 'OPEN',
  status: 'ACTIVE',
  startDate: '2026-07-06',
  endDate: '2026-07-10',
};
const options = (can: Partial<Record<string, boolean>> = {}) => ({
  years: [YEAR],
  academicYearId: YEAR.id,
  sections: [section],
  exams: [exam],
  can: {
    examReports: true,
    markSheets: true,
    classAttendance: true,
    annualReports: true,
    publishAnnual: true,
    ...can,
  },
});
const counts = { total: 10, marked: 10, notMarked: 0, P: 9, A: 1, L: 0, C: 0, percentage: 90 };
const summary = {
  total: 140,
  max: 200,
  percentage: 70,
  result: 'PASS',
  rank: 1,
  rankedOf: 2,
  rankScope: 'SECTION',
};
const result = (complete = true) => ({
  academicYear: { id: YEAR.id, label: YEAR.label, status: 'CURRENT' },
  exam,
  student: {
    id: uuid(10),
    fullName: 'TEST Student One',
    admissionNumber: 'ADM-1',
    rollNumber: '1',
  },
  section,
  subjects: [
    {
      subjectId: uuid(20),
      subjectName: 'TEST Maths',
      countsInResult: true,
      available: true,
      components: null,
      totalMax: 100,
      obtained: 80,
      normalizedMax: null,
      normalized: null,
      finalMax: 100,
      final: 80,
      percent: 80,
      grade: 'A',
      result: 'PASS',
    },
  ],
  complete,
  availableCount: complete ? 1 : 0,
  requiredCount: 1,
  summary: complete ? summary : null,
});
const content = (extra: object = {}) => ({
  school: {
    fullName: 'TEST School',
    shortName: 'TEST',
    address: null,
    phone: null,
    email: null,
    website: null,
    motto: null,
  },
  academicYear: YEAR,
  student: {
    id: uuid(10),
    fullName: 'TEST Student One',
    admissionNumber: 'ADM-1',
    rollNumber: '1',
  },
  section,
  exams: [{ exam, weightagePercent: 100, result: result() }],
  annual: {
    weightageTotalPercent: 100,
    contributions: [
      { examId: exam.id, examName: exam.name, weightagePercent: 100, percentage: 70, weighted: 70 },
    ],
    percentage: 70,
  },
  attendance: { from: '2026-06-01', to: '2026-09-21', counts },
  behaviour: [],
  achievements: [],
  suggestedRemark: 'TEST Student One achieved an annual percentage of 70% across 1 weighted exam.',
  finalRemark: null,
  problems: [],
  ...extra,
});
const view = (extra: object = {}, contentExtra: object = {}) => ({
  id: uuid(30),
  status: 'DRAFT',
  revision: 1,
  content: content(contentExtra),
  frozen: false,
  finalized: null,
  published: null,
  fileName: 'TEST_TEST-2026_AnnualReport_ADM-1.pdf',
  actions: {
    prepare: false,
    editRemark: true,
    finalize: true,
    publish: false,
    unpublish: false,
    reopen: false,
  },
  ...extra,
});

describe('reports hub', () => {
  it('administrator: report types as tabs; report cards list with PDF only for complete results', async () => {
    installFetch(
      signedInAs(admin(), {
        'GET /reports/options': () => ok(options()),
        [`GET /results/exams/${exam.id}/sections/${SEC}`]: () =>
          ok({
            academicYear: { id: YEAR.id, label: YEAR.label, status: 'CURRENT' },
            exam,
            section,
            rankScope: 'SECTION',
            subjects: [],
            students: [
              {
                studentId: uuid(10),
                rollNumber: '1',
                admissionNumber: 'ADM-1',
                fullName: 'TEST Student One',
                cells: [],
                complete: true,
                summary,
              },
              {
                studentId: uuid(11),
                rollNumber: '2',
                admissionNumber: 'ADM-2',
                fullName: 'TEST Student Two',
                cells: [],
                complete: false,
                summary: null,
              },
            ],
            rankedOf: 1,
          }),
      }),
    );
    renderApp('/reports');
    const tabs = await screen.findByRole('tablist', { name: 'Report types' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual([
      'Report cards',
      'Mark sheets',
      'Attendance',
      'Student performance',
      'Annual reports',
    ]);
    expect(await screen.findByText(/TEST Student Two/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Report card PDF for TEST Student One/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /Report card PDF for TEST Student Two/ }),
    ).toBeDisabled();
  });

  it('a subject teacher only gets mark sheets', async () => {
    installFetch(
      signedInAs(user({ permissions: ['reports.view', 'marks.view'] }), {
        'GET /reports/options': () =>
          ok(
            options({
              examReports: false,
              classAttendance: false,
              annualReports: false,
              publishAnnual: false,
            }),
          ),
        'GET /marks': () =>
          ok({
            years: [{ id: YEAR.id, label: YEAR.label, status: 'CURRENT' }],
            academicYearId: YEAR.id,
            exams: [
              {
                ...exam,
                sheets: [
                  {
                    examSubjectId: uuid(40),
                    sectionId: SEC,
                    classId: uuid(3),
                    className: 'TEST-X',
                    sectionName: 'A',
                    subjectId: uuid(20),
                    subjectName: 'TEST Maths',
                    status: 'SUBMITTED',
                    entered: 30,
                    role: 'ENTRY_TEACHER',
                  },
                ],
              },
            ],
          }),
      }),
    );
    renderApp('/reports');
    const tabs = await screen.findByRole('tablist', { name: 'Report types' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Mark sheets']);
    expect(
      await screen.findByRole('button', { name: /Mark sheet PDF for TEST Maths TEST-X A/ }),
    ).toBeInTheDocument();
  });

  it('downloads a generated PDF from the server (not a fake link)', async () => {
    const { calls } = installFetch(
      signedInAs(admin(), {
        'GET /reports/options': () => ok(options()),
        [`GET /reports/attendance/class?sectionId=${SEC}&from=2026-06-01&to=2026-09-21&format=xlsx`]:
          () => ({
            status: 200,
            body: 'PK-binary',
          }),
        'GET /reports/attendance/class': () =>
          ok({
            kind: 'CLASS_ATTENDANCE',
            school: content().school,
            generatedAt: '2026-09-21T03:30:00.000Z',
            fileName: 'x.pdf',
            academicYear: { id: YEAR.id, label: YEAR.label, status: 'CURRENT' },
            summary: {
              section,
              from: '2026-06-01',
              to: '2026-09-21',
              students: [
                {
                  studentId: uuid(10),
                  rollNumber: '1',
                  admissionNumber: 'ADM-1',
                  fullName: 'TEST Student One',
                  counts,
                },
              ],
              counts,
            },
            lessonCount: 10,
          }),
      }),
    );
    const createObjectURL = vi.fn(() => 'blob:report');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    renderApp(`/reports?tab=attendance&from=2026-06-01&to=2026-09-21`);
    expect(await screen.findByText('TEST Student One')).toBeInTheDocument();
    expect(screen.getByText('90%', { selector: 'dd' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Excel$/ }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(calls).toContain(
      `GET /reports/attendance/class?sectionId=${SEC}&from=2026-06-01&to=2026-09-21&format=xlsx`,
    );
  });
});

describe('annual report page', () => {
  it('draft: problems block finalizing; remark is saved; finalize is confirmed with the revision', async () => {
    let remarkBody: any = null;
    let finalizeBody: any = null;
    installFetch(
      signedInAs(admin(), {
        'GET /reports/annual': () =>
          ok(
            view(
              {
                actions: {
                  prepare: false,
                  editRemark: true,
                  finalize: false,
                  publish: false,
                  unpublish: false,
                  reopen: false,
                },
              },
              { problems: ['TEST Term 2: result incomplete (0 of 1 subjects published).'] },
            ),
          ),
        [`PUT /reports/annual/${uuid(30)}/remark`]: (init) => {
          remarkBody = JSON.parse(String(init?.body));
          return ok(view({ revision: 2 }, { finalRemark: remarkBody.remark }));
        },
        [`POST /reports/annual/${uuid(30)}/finalize`]: (init) => {
          finalizeBody = JSON.parse(String(init?.body));
          return ok(
            view(
              {
                status: 'FINALIZED',
                revision: 3,
                frozen: true,
                finalized: { at: '2026-09-21T04:00:00.000Z', by: 'Test Admin' },
                actions: {
                  prepare: false,
                  editRemark: false,
                  finalize: false,
                  publish: true,
                  unpublish: false,
                  reopen: true,
                },
              },
              { finalRemark: 'Sincere work.' },
            ),
          );
        },
      }),
    );
    renderApp(`/reports/annual/${YEAR.id}/${uuid(10)}`);
    expect(await screen.findByText(/TEST Term 2: result incomplete/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalize' })).toBeDisabled();
    expect(screen.getByText(/never printed on the official report/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Class teacher's final remark"), 'Sincere work.');
    await userEvent.click(screen.getByRole('button', { name: 'Save remark' }));
    await waitFor(() => expect(remarkBody).toEqual({ remark: 'Sincere work.', revision: 1 }));
    // The saved draft (problems gone in this fixture) can now be finalized.
    await userEvent.click(await screen.findByRole('button', { name: 'Finalize' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/frozen as the official report/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finalize' }));
    await waitFor(() => expect(finalizeBody).toEqual({ revision: 2 }));
    expect(await screen.findByText('Finalized')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish to student' })).toBeInTheDocument();
    expect(screen.queryByText(/never printed on the official report/)).toBeNull();
  });
});

describe('my reports (student)', () => {
  it('shows only own reports: incomplete card without download, nothing published yet', async () => {
    installFetch(
      signedInAs(
        user({
          roles: ['STUDENT'],
          accountRole: 'STUDENT',
          teacherId: null,
          studentId: uuid(10),
          permissions: ['reports.view', 'results.view'],
        }),
        {
          'GET /results/me': () =>
            ok({
              years: [{ id: YEAR.id, label: YEAR.label, status: 'CURRENT' }],
              academicYearId: YEAR.id,
              exams: [exam],
              sections: [],
            }),
          'GET /reports/exam-card': () =>
            ok({
              kind: 'EXAM_REPORT_CARD',
              school: content().school,
              generatedAt: 't',
              fileName: 'x.pdf',
              result: result(false),
              official: false,
            }),
          'GET /reports/annual/mine': () => ok({ items: [] }),
        },
      ),
    );
    renderApp('/portal/reports');
    expect(await screen.findByText(/Not published/)).toBeInTheDocument();
    expect(await screen.findByText(/Incomplete · 0 of 1 subjects published/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Report card PDF/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Download attendance report/ })).toBeEnabled();
  });
});
