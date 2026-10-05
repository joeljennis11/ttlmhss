// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads untyped request bodies */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { admin, installFetch, renderApp, signedInAs, user } from './support/render-app';

/*
 * Attendance UI (Phase 7). The network is stubbed with synthetic TEST data; the rules (scope,
 * cutoff, conflicts) are covered by the API tests and the browser end-to-end tests.
 */
const ok = (data: unknown) => ({ status: 200, body: { data } });
const counts = (extra = {}) => ({
  total: 3,
  marked: 0,
  notMarked: 3,
  P: 0,
  A: 0,
  L: 0,
  C: 0,
  percentage: null,
  ...extra,
});
const row = (n: number, extra = {}) => ({
  studentId: `00000000-0000-4000-8000-00000000000${n}`,
  enrolmentId: `e${n}`,
  rollNumber: String(n),
  admissionNumber: `T/00${n}`,
  fullName: `Test Pupil ${n}`,
  status: '-',
  leaveReason: null,
  note: null,
  onRoll: true,
  editable: true,
  updatedAt: null,
  updatedBy: null,
  ...extra,
});
const register = (extra: Record<string, any> = {}) => ({
  context: {
    date: '2026-10-05',
    day: 'MON',
    academicYear: { id: 'y1', label: 'TEST-2026', status: 'CURRENT' },
    period: {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'LESSON',
      periodNumber: 3,
      label: 'Period 3',
      startTime: '10:10',
      endTime: '11:00',
      status: 'ACTIVE',
    },
    section: {
      sectionId: '22222222-2222-4222-8222-222222222222',
      sectionName: 'A',
      classId: 'c',
      className: 'TEST-X',
    },
    subject: { id: 's', name: 'Test Maths', code: null },
    teacher: { id: 't1', fullName: 'Test Arun', staffCode: 'T1' },
    timetableEntryId: 'te',
    timetableVersionId: 'tv',
  },
  session: null,
  rows: [row(1), row(2, { status: 'A' }), row(3)],
  counts: counts({ marked: 1, notMarked: 2, A: 1, percentage: 0 }),
  access: {
    canMark: true,
    canManage: false,
    locked: false,
    lockDate: null,
    canOverride: false,
    editable: true,
    readOnlyReason: null,
  },
  ...extra,
});
const URL_ =
  '/attendance/register?date=2026-10-05&periodId=11111111-1111-4111-8111-111111111111&sectionId=22222222-2222-4222-8222-222222222222';
const teacher = () =>
  user({ permissions: ['attendance.view', 'attendance.mark', 'timetable.view'] });

describe('attendance register', () => {
  it('shows the lesson from the server and the roster; unmarked stays "-"', async () => {
    installFetch(signedInAs(teacher(), { 'GET /attendance/register': () => ok(register()) }));
    renderApp(URL_);
    expect(await screen.findByText('Monday, 5 October 2026')).toBeInTheDocument();
    expect(screen.getByText('Period 3 · 10:10 AM – 11:00 AM')).toBeInTheDocument();
    expect(screen.getByText('Test Arun')).toBeInTheDocument();
    const first = screen.getByRole('group', { name: 'Attendance for Test Pupil 1' });
    expect(within(first).getByRole('radio', { name: 'Not marked' })).toBeChecked();
    // Subject teacher: P / A / - only.
    expect(within(first).queryByRole('radio', { name: 'Leave' })).not.toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
  });

  it('Mark all present fills only unmarked students; saving sends just the changes with the revision', async () => {
    const bodies: any[] = [];
    installFetch(
      signedInAs(teacher(), {
        'GET /attendance/register': () => ok(register()),
        'PUT /attendance/register': (init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return ok(
            register({
              session: {
                id: 'sess',
                revision: 1,
                updatedAt: '2026-10-05T05:00:00.000Z',
                updatedBy: 'test.user',
              },
              rows: [row(1, { status: 'P' }), row(2, { status: 'A' }), row(3, { status: 'P' })],
            }),
          );
        },
      }),
    );
    renderApp(URL_);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all present' }));
    expect(
      await screen.findByText(/2 unmarked students set to Present; 1 marked A, L or C kept/),
    ).toBeInTheDocument();
    const second = screen.getByRole('group', { name: 'Attendance for Test Pupil 2' });
    expect(within(second).getByRole('radio', { name: 'Absent' })).toBeChecked();
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      date: '2026-10-05',
      revision: null,
      marks: [
        { studentId: row(1).studentId, status: 'P' },
        { studentId: row(3).studentId, status: 'P' },
      ],
    });
    expect(await screen.findByText('Attendance saved')).toBeInTheDocument();
    expect(screen.getByText(/Saved .* by test\.user/)).toBeInTheDocument();
  });

  it('class teachers set Leave with a reason ("Other" needs a description) before anything is sent', async () => {
    const { calls } = installFetch(
      signedInAs(teacher(), {
        'GET /attendance/register': () =>
          ok(register({ access: { ...register().access, canManage: true } })),
      }),
    );
    renderApp(URL_);
    const first = await screen.findByRole('group', { name: 'Attendance for Test Pupil 1' });
    await userEvent.click(within(first).getByRole('radio', { name: 'Leave' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('Choose a leave reason')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/^Leave reason/), 'OTHER');
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('Describe the reason for "Other"')).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith('PUT'))).toHaveLength(0);
  });

  it('Leave set by the class teacher is read-only for a subject teacher', async () => {
    installFetch(
      signedInAs(teacher(), {
        'GET /attendance/register': () =>
          ok(
            register({ rows: [row(1, { status: 'L', leaveReason: 'MEDICAL', editable: false })] }),
          ),
      }),
    );
    renderApp(URL_);
    expect(
      await screen.findByText(/Leave \(Medical\) — set by the class teacher/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Attendance for Test Pupil 1' }),
    ).not.toBeInTheDocument();
  });

  it('locked dates: an administrator must confirm an override with a reason', async () => {
    const bodies: any[] = [];
    installFetch(
      signedInAs(admin(), {
        'GET /attendance/register': () =>
          ok(
            register({
              access: {
                canMark: true,
                canManage: true,
                locked: true,
                lockDate: '2026-11-08',
                canOverride: true,
                editable: true,
                readOnlyReason: null,
              },
            }),
          ),
        'PUT /attendance/register': (init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return ok(register());
        },
      }),
    );
    renderApp(URL_);
    const first = await screen.findByRole('group', { name: 'Attendance for Test Pupil 1' });
    await userEvent.click(within(first).getByRole('radio', { name: 'Present' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Attendance for this date is locked',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save with override' }));
    expect(bodies).toHaveLength(0); // no reason yet
    await userEvent.type(
      within(dialog).getByLabelText(/Reason for the override/),
      'Register corrected',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save with override' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].override).toEqual({ reason: 'Register corrected' });
  });

  it('a concurrent save is reported with a way to reload', async () => {
    installFetch(
      signedInAs(teacher(), {
        'GET /attendance/register': () => ok(register()),
        'PUT /attendance/register': () => ({
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message:
                'This register was saved by test.other while you were working. Reload it to see the latest attendance.',
            },
          },
        }),
      }),
    );
    renderApp(URL_);
    const first = await screen.findByRole('group', { name: 'Attendance for Test Pupil 1' });
    await userEvent.click(within(first).getByRole('radio', { name: 'Present' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('Someone else saved this register')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload the register/ })).toBeInTheDocument();
  });
});

describe('student attendance', () => {
  it('shows only the server totals and days, with the P / (P + A) percentage', async () => {
    installFetch(
      signedInAs(
        user({
          roles: ['STUDENT'],
          accountRole: 'STUDENT',
          permissions: ['attendance.view'],
          teacherId: null,
          studentId: 'st1',
        }),
        {
          'GET /attendance/me': () =>
            ok({
              student: { id: 'st1', fullName: 'Test Pupil 1', admissionNumber: 'T/001' },
              from: '2026-09-08',
              to: '2026-10-05',
              periods: [{ id: 'p1', label: 'Period 1', periodNumber: 1 }],
              days: [
                {
                  date: '2026-10-05',
                  day: 'MON',
                  cells: {
                    p1: { status: 'A', subjectName: 'Test Maths', teacherName: 'Test Teacher' },
                  },
                },
              ],
              counts: {
                total: 3,
                marked: 3,
                notMarked: 0,
                P: 2,
                A: 1,
                L: 0,
                C: 0,
                percentage: 66.67,
              },
            }),
        },
      ),
    );
    renderApp('/attendance');
    expect(await screen.findByRole('heading', { name: 'My attendance' })).toBeInTheDocument();
    expect(await screen.findByText('66.67%')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Attendance by day and period' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save attendance' })).not.toBeInTheDocument();
  });
});
