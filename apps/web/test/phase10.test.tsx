// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads untyped request bodies */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { admin, installFetch, renderApp, signedInAs, user } from './support/render-app';

/* Phase 10 UI: dashboards, announcements and requests. Synthetic TEST data only. */
const ok = (data: unknown, status = 200) => ({ status, body: { data } });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const YEAR = { id: uuid(1), label: 'TEST-2026', status: 'CURRENT' };
const SEC = uuid(2);
const PERIOD = uuid(3);
const section = { sectionId: SEC, sectionName: 'A', classId: uuid(4), className: 'TEST-X' };
const counts = (P = 0, A = 0, notMarked = 0) => ({
  total: P + A + notMarked,
  marked: P + A,
  notMarked,
  P,
  A,
  L: 0,
  C: 0,
  percentage: P + A ? Math.round((P / (P + A)) * 10000) / 100 : null,
});
const exam = {
  id: uuid(5),
  name: 'TEST Mid Term',
  stage: 'OPEN',
  status: 'ACTIVE',
  startDate: null,
  endDate: null,
};
const announcement = (extra: object = {}) => ({
  id: uuid(6),
  academicYear: YEAR,
  title: 'TEST Sports day',
  body: 'Sports day is on Friday. Wear the house T-shirt.',
  audience: 'SCHOOL',
  audienceLabel: 'Whole school',
  classId: null,
  sectionId: null,
  status: 'PUBLISHED',
  publishedAt: '2026-09-21T03:00:00.000Z',
  expiresOn: null,
  expired: false,
  author: 'Test Admin',
  createdAt: '2026-09-21T03:00:00.000Z',
  updatedAt: '2026-09-21T03:00:00.000Z',
  canManage: false,
  ...extra,
});
const request = (extra: object = {}) => ({
  id: uuid(7),
  reference: 'RQ-00000000',
  type: 'ATTENDANCE_ISSUE',
  status: 'OPEN',
  summary: 'Attendance on 21 Sep 2026, Period 1 (TEST Maths)',
  academicYear: YEAR,
  student: { id: uuid(8), fullName: 'TEST Student One', admissionNumber: 'ADM-1', rollNumber: '1' },
  section,
  requester: { name: 'TEST Student One', role: 'STUDENT' },
  related: {
    date: '2026-09-21',
    period: { id: PERIOD, label: 'Period 1' },
    subject: { id: uuid(9), name: 'TEST Maths' },
    exam: null,
    field: null,
  },
  description: 'I was present in Maths.',
  assignedTo: { userId: uuid(10), name: 'TEST Kumar' },
  resolutionNote: null,
  resolvedBy: null,
  createdAt: '2026-09-21T04:00:00.000Z',
  updatedAt: '2026-09-21T04:00:00.000Z',
  resolvedAt: null,
  closedAt: null,
  revision: 1,
  actions: { startReview: false, resolve: false, close: false, reopen: false, assign: false },
  ...extra,
});
const period = {
  id: PERIOD,
  kind: 'LESSON',
  periodNumber: 1,
  label: 'Period 1',
  startTime: '08:00',
  endTime: '08:45',
  status: 'ACTIVE',
};
const dashboard = (extra: object = {}) => ({
  date: '2026-09-21',
  academicYear: YEAR,
  admin: null,
  teaching: null,
  classes: [],
  student: null,
  announcements: { items: [], total: 0 },
  requests: null,
  ...extra,
});

describe('dashboards', () => {
  it('administrator: real counts, today, exams and quick actions to existing pages', async () => {
    installFetch(
      signedInAs(admin(), {
        'GET /dashboard': () =>
          ok(
            dashboard({
              admin: {
                counts: {
                  activeStudents: 412,
                  activeTeachers: 31,
                  activeClasses: 12,
                  activeSections: 24,
                },
                today: {
                  schoolDay: true,
                  notes: [],
                  attendance: {
                    lessons: 10,
                    taken: 7,
                    counts: counts(60, 4, 30),
                    pending: [{ section, lessons: 5, taken: 2, counts: counts(20, 1, 30) }],
                    workingSections: 2,
                  },
                },
                exams: [
                  {
                    ...exam,
                    sheets: { total: 8, notStarted: 2, draft: 3, submitted: 3, unlocked: 0 },
                  },
                ],
                timetableRequests: { pending: 0, items: [] },
              },
              announcements: { items: [announcement()], total: 1 },
              requests: { items: [request()], active: 1 },
            }),
          ),
      }),
    );
    renderApp('/');
    expect(await screen.findByText('412')).toBeInTheDocument();
    expect(screen.getByText('You are signed in as Administrator.')).toBeInTheDocument();
    const stats = screen.getByRole('list', { name: 'School at a glance' });
    expect(within(stats).getByRole('link', { name: /412\s*Active students/ })).toHaveAttribute(
      'href',
      '/students',
    );
    const quick = screen.getByRole('navigation', { name: 'Quick actions' });
    expect(within(quick).getByRole('link', { name: 'Add student' })).toHaveAttribute(
      'href',
      '/students/new',
    );
    expect(within(quick).getByRole('link', { name: 'Academic calendar' })).toHaveAttribute(
      'href',
      '/admin/academic-calendar',
    );
    expect(screen.getByText(/registers taken in 2 working sections/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open class day' })).toHaveAttribute(
      'href',
      `/attendance/class?date=2026-09-21&section=${SEC}`,
    );
    expect(
      screen.getByText(/3 of 8 mark sheets submitted · 3 in draft · 2 not started/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TEST Sports day' })).toHaveAttribute(
      'href',
      `/announcements/${uuid(6)}`,
    );
    expect(screen.getByRole('link', { name: /Attendance on 21 Sep 2026/ })).toHaveAttribute(
      'href',
      `/requests/${uuid(7)}`,
    );
  });

  it('teacher: today’s lessons with the real attendance action and pending mark entry', async () => {
    installFetch(
      signedInAs(
        user({
          permissions: ['attendance.view', 'attendance.mark', 'marks.view', 'announcements.view'],
        }),
        {
          'GET /dashboard': () =>
            ok(
              dashboard({
                teaching: {
                  lessons: {
                    date: '2026-09-21',
                    day: 'MON',
                    academicYear: YEAR,
                    schoolDay: true,
                    future: false,
                    teacher: { id: 't1', fullName: 'Test User', staffCode: 'T1' },
                    lessons: [
                      {
                        period,
                        section,
                        subject: { id: uuid(9), name: 'TEST Maths', code: null },
                        attendance: { taken: false, counts: counts(0, 0, 30), locked: false },
                      },
                    ],
                  },
                  markTasks: [
                    {
                      exam,
                      examSubjectId: uuid(11),
                      sectionId: SEC,
                      className: 'TEST-X',
                      sectionName: 'A',
                      subjectName: 'TEST Maths',
                      state: 'READY_TO_SUBMIT',
                      entered: 30,
                      total: 30,
                    },
                    {
                      exam,
                      examSubjectId: uuid(12),
                      sectionId: SEC,
                      className: 'TEST-X',
                      sectionName: 'A',
                      subjectName: 'TEST Physics',
                      state: 'SUBMITTED',
                      entered: 30,
                      total: null,
                    },
                  ],
                },
              }),
            ),
        },
      ),
    );
    renderApp('/');
    const take = await screen.findByRole('link', { name: /Take attendance/ });
    expect(take).toHaveAttribute(
      'href',
      `/attendance/register?date=2026-09-21&periodId=${PERIOD}&sectionId=${SEC}`,
    );
    const marks = screen.getByRole('list', { name: 'Pending mark entry' });
    expect(within(marks).getAllByRole('listitem')).toHaveLength(1);
    expect(within(marks).getByText('Ready to submit')).toBeInTheDocument();
    expect(screen.getByText('1 of your sheets are submitted.')).toBeInTheDocument();
    expect(screen.getByText('No announcements right now.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'School at a glance' })).toBeNull();
  });

  it('student: own home with today, attendance, results and empty states — not the staff layout', async () => {
    installFetch(
      signedInAs(
        user({
          roles: ['STUDENT'],
          accountRole: 'STUDENT',
          teacherId: null,
          studentId: uuid(8),
          permissions: [
            'attendance.view',
            'announcements.view',
            'requests.view',
            'requests.create',
          ],
        }),
        {
          'GET /dashboard': () =>
            ok(
              dashboard({
                student: {
                  student: {
                    fullName: 'TEST Student One',
                    admissionNumber: 'ADM-1',
                    rollNumber: '1',
                  },
                  section,
                  today: {
                    date: '2026-09-21',
                    schoolDay: true,
                    section,
                    lessons: [
                      {
                        period: {
                          id: PERIOD,
                          label: 'Period 1',
                          periodNumber: 1,
                          startTime: '08:00',
                          endTime: '08:45',
                        },
                        subject: { id: uuid(9), name: 'TEST Maths' },
                        teacherName: 'TEST Arun',
                        status: 'P',
                      },
                    ],
                  },
                  attendance: { from: '2026-08-25', to: '2026-09-21', counts: counts(9, 1) },
                  latestResult: null,
                  behaviour: null,
                  achievements: [],
                },
                requests: { items: [], active: 0 },
              }),
            ),
        },
      ),
    );
    renderApp('/');
    expect(await screen.findByText('TEST-X A')).toBeInTheDocument();
    const lessons = screen.getByRole('list', { name: "Today's lessons" });
    expect(within(lessons).getByText('TEST Maths')).toBeInTheDocument();
    expect(within(lessons).getByText('Present')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('No results have been published for you yet.')).toBeInTheDocument();
    expect(screen.getByText('No behaviour assessment has been published yet.')).toBeInTheDocument();
    expect(screen.getByText('No achievements recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('You have no open requests.')).toBeInTheDocument();
    expect(screen.getByText('No announcements right now.')).toBeInTheDocument();
    const links = screen.getByRole('navigation', { name: 'My portal' });
    expect(within(links).getByRole('link', { name: 'Requests' })).toHaveAttribute(
      'href',
      '/portal/requests',
    );
    expect(screen.queryByRole('navigation', { name: 'Quick actions' })).toBeNull();
  });
});

describe('announcements', () => {
  const classTeacher = () =>
    user({
      roles: ['TEACHER', 'CLASS_TEACHER'],
      permissions: ['announcements.view', 'announcements.manage'],
      classTeacherOf: [{ academicYearId: YEAR.id, sectionId: SEC }],
    });

  it('a class teacher writes for their own section only; the request carries the target', async () => {
    let posted: any = null;
    installFetch(
      signedInAs(classTeacher(), {
        'GET /announcements/options': () =>
          ok({
            academicYear: YEAR,
            years: [YEAR],
            audiences: ['SECTION'],
            classes: [],
            sections: [section],
          }),
        'GET /announcements': () => ok({ items: [], page: 1, pageSize: 12, total: 0 }),
        'POST /announcements': (init) => {
          posted = JSON.parse(String(init?.body));
          return ok(announcement({ audience: 'SECTION', audienceLabel: 'TEST-X A' }), 201);
        },
      }),
    );
    renderApp('/announcements/manage');
    await userEvent.click(await screen.findByRole('button', { name: 'New announcement' }));
    const dialog = screen.getByRole('dialog');
    const audience = within(dialog).getByLabelText(/Audience/);
    expect(
      within(audience)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['A class section']);
    // Empty title is caught before sending.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(within(dialog).getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Bring lab coats');
    await userEvent.type(
      within(dialog).getByLabelText('Message'),
      'Tomorrow, chemistry practical.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toEqual({
      announcement: {
        title: 'Bring lab coats',
        body: 'Tomorrow, chemistry practical.',
        audience: 'SECTION',
        classId: null,
        sectionId: SEC,
        expiresOn: null,
      },
      publish: true,
    });
  });

  it('managers archive with a confirmation; the full announcement opens on its own page', async () => {
    const { calls } = installFetch(
      signedInAs(admin(), {
        'GET /announcements/options': () =>
          ok({
            academicYear: YEAR,
            years: [YEAR],
            audiences: ['SCHOOL', 'STAFF', 'CLASS', 'SECTION'],
            classes: [{ id: uuid(4), name: 'TEST-X' }],
            sections: [section],
          }),
        'GET /announcements': () =>
          ok({ items: [announcement({ canManage: true })], page: 1, pageSize: 12, total: 1 }),
        [`POST /announcements/${uuid(6)}/archive`]: () =>
          ok(announcement({ canManage: true, status: 'ARCHIVED' })),
        [`GET /announcements/${uuid(6)}`]: () => ok(announcement()),
      }),
    );
    renderApp('/announcements/manage');
    await userEvent.click(await screen.findByRole('button', { name: 'Archive TEST Sports day' }));
    expect(screen.getByText(/will no longer be shown to its audience/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(calls).toContain(`POST /announcements/${uuid(6)}/archive`));
    await userEvent.click(screen.getByRole('link', { name: 'TEST Sports day' }));
    expect(
      await screen.findByText('Sports day is on Friday. Wear the house T-shirt.'),
    ).toBeInTheDocument();
  });
});

describe('requests', () => {
  const student = () =>
    user({
      roles: ['STUDENT'],
      accountRole: 'STUDENT',
      teacherId: null,
      studentId: uuid(8),
      permissions: ['attendance.view', 'requests.view', 'requests.create'],
    });

  it('a student’s attendance issue chooses a real lesson of that day and sends a structured body', async () => {
    let posted: any = null;
    installFetch(
      signedInAs(student(), {
        'GET /requests/mine': () => ok({ items: [], page: 1, pageSize: 20, total: 0 }),
        'GET /requests/options': () =>
          ok({
            academicYear: YEAR,
            section,
            exams: [],
            attendanceFrom: '2026-06-01',
            attendanceTo: '2026-09-21',
            activeCount: 0,
            activeLimit: 10,
          }),
        'GET /attendance/me/day': () =>
          ok({
            date: '2026-09-21',
            schoolDay: true,
            section,
            lessons: [
              {
                period: {
                  id: PERIOD,
                  label: 'Period 1',
                  periodNumber: 1,
                  startTime: '08:00',
                  endTime: '08:45',
                },
                subject: { id: uuid(9), name: 'TEST Maths' },
                teacherName: 'TEST Arun',
                status: 'A',
              },
            ],
          }),
        'POST /requests': (init) => {
          posted = JSON.parse(String(init?.body));
          return ok({ request: request(), history: [], assignees: [] }, 201);
        },
        [`GET /requests/${uuid(7)}`]: () => ok({ request: request(), history: [], assignees: [] }),
      }),
    );
    renderApp('/portal/requests');
    expect(await screen.findByText('You have no requests here.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New request' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('What is it about?'),
      'ATTENDANCE_ISSUE',
    );
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-09-21' } });
    const periodSelect = within(dialog).getByLabelText('Period');
    await waitFor(() =>
      expect(
        within(periodSelect).getByRole('option', { name: /TEST Maths · marked Absent/ }),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(periodSelect, PERIOD);
    await userEvent.type(
      within(dialog).getByLabelText('Describe the problem'),
      'I was present in Maths.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toEqual({
      type: 'ATTENDANCE_ISSUE',
      date: '2026-09-21',
      periodId: PERIOD,
      description: 'I was present in Maths.',
    });
    // Opens the request: status and "waiting" text; no staff review controls.
    expect(await screen.findByText(/waiting to be reviewed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('a reviewer resolves with a note; the request (not the record) is updated', async () => {
    let posted: any = null;
    const reviewer = user({
      roles: ['TEACHER', 'CLASS_TEACHER'],
      permissions: ['requests.view', 'requests.handle', 'attendance.manage'],
      classTeacherOf: [{ academicYearId: YEAR.id, sectionId: SEC }],
    });
    const open = request({
      status: 'IN_REVIEW',
      revision: 2,
      actions: { startReview: false, resolve: true, close: true, reopen: false, assign: false },
    });
    installFetch(
      signedInAs(reviewer, {
        [`GET /requests/${uuid(7)}`]: () =>
          ok({
            request: open,
            history: [
              {
                at: '2026-09-21T04:00:00.000Z',
                actor: 'TEST Student One',
                action: 'Request created',
                summary: 'Status: Open',
                note: null,
              },
            ],
            assignees: [],
          }),
        [`POST /requests/${uuid(7)}/status`]: (init) => {
          posted = JSON.parse(String(init?.body));
          return ok({
            request: request({
              status: 'RESOLVED',
              revision: 3,
              resolutionNote: 'Register corrected by the subject teacher.',
              resolvedAt: '2026-09-21T05:00:00.000Z',
              resolvedBy: 'TEST Kumar',
            }),
            history: [],
            assignees: [],
          });
        },
      }),
    );
    renderApp(`/requests/${uuid(7)}`);
    expect(
      await screen.findByRole('link', { name: 'Open the class attendance for that day' }),
    ).toHaveAttribute('href', `/attendance/class?date=2026-09-21&section=${SEC}`);
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText('Resolution'),
      'Register corrected by the subject teacher.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toEqual({
      status: 'RESOLVED',
      note: 'Register corrected by the subject teacher.',
      revision: 2,
    });
    expect(
      await screen.findByText('Register corrected by the subject teacher.'),
    ).toBeInTheDocument();
  });
});
