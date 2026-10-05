// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads untyped request bodies */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { installFetch, renderApp, signedInAs, user } from './support/render-app';

/* Phase 9 UI: student portal, behaviour sheet and achievements. Synthetic TEST data only. */
const ok = (data: unknown) => ({ status: 200, body: { data } });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const Y1 = uuid(8);
const STUDENT = uuid(1);
const EXAM = uuid(2);
const SEC = uuid(3);
const CAT1 = uuid(4);
const CAT2 = uuid(5);
const YEAR = { id: Y1, label: 'TEST-2026', status: 'CURRENT' };
const section = { sectionId: SEC, sectionName: 'A', classId: 'c1', className: 'TEST-X' };
const exam = {
  id: EXAM,
  name: 'TEST Mid Term',
  stage: 'OPEN',
  status: 'ACTIVE',
  startDate: null,
  endDate: null,
};

const student = () =>
  user({
    roles: ['STUDENT'],
    accountRole: 'STUDENT',
    teacherId: null,
    studentId: STUDENT,
    permissions: [
      'students.view',
      'timetable.view',
      'attendance.view',
      'results.view',
      'behaviour.view',
      'achievements.view',
    ],
  });
const classTeacher = () =>
  user({
    roles: ['TEACHER', 'CLASS_TEACHER'],
    permissions: [
      'behaviour.view',
      'behaviour.manage',
      'achievements.view',
      'achievements.manage',
      'students.view',
    ],
    classTeacherOf: [{ academicYearId: Y1, sectionId: SEC }],
  });

const placement = {
  enrolmentId: 'e1',
  academicYearId: Y1,
  academicYearLabel: 'TEST-2026',
  classId: 'c1',
  className: 'TEST-X',
  sectionId: SEC,
  sectionName: 'A',
  rollNumber: '7',
  status: 'ACTIVE',
  startedOn: '2026-06-01',
  endedOn: null,
};
const profile = {
  student: {
    id: STUDENT,
    fullName: 'TEST Student One',
    admissionNumber: 'ADM-1',
    admissionDate: '2026-06-01',
    dateOfBirth: null,
    gender: 'FEMALE',
    fatherName: 'TEST Father',
    motherName: null,
    guardianName: null,
    guardianRelation: null,
    guardianPhone: null,
    phone: null,
    email: null,
    address: null,
    city: null,
    state: null,
    pincode: null,
    status: 'ACTIVE',
  },
  account: { username: 'test.student', status: 'ACTIVE' },
  currentYear: YEAR,
  current: placement,
  history: [placement],
};
const achievement = (extra: object = {}) => ({
  id: uuid(9),
  academicYear: YEAR,
  student: { id: STUDENT, fullName: 'TEST Student One', admissionNumber: 'ADM-1', rollNumber: '7' },
  section,
  category: { id: uuid(6), name: 'TEST Sports' },
  title: 'District 100 m — first place',
  description: 'Athletics meet',
  achievedOn: '2026-08-15',
  hasAttachment: false,
  status: 'ACTIVE',
  createdBy: null,
  updatedAt: 't',
  canManage: false,
  ...extra,
});

describe('student portal', () => {
  it('shows the portal menu, the overview and a read-only profile with history', async () => {
    installFetch(signedInAs(student(), { 'GET /portal/profile': () => ok(profile) }));
    renderApp('/portal');
    expect(await screen.findByText('Hello, TEST Student One')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([
      'Home',
      'My portal',
      'My profile',
      'Timetable',
      'Attendance',
      'Marks & results',
      'Behaviour',
      'Achievements',
      'Change password',
    ]);
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Student portal' })).getByRole('link', {
        name: /My profile/,
      }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'My profile' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ADM-1')).toBeInTheDocument();
    expect(screen.getByText('Female')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('TEST-X A');
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('timetable lists subjects with their teachers from the published week', async () => {
    const entry = (id: number, day: string, subject: string, teacher: string) => ({
      id: uuid(100 + id),
      day,
      periodId: 'p1',
      classId: 'c1',
      className: 'TEST-X',
      sectionId: SEC,
      sectionName: 'A',
      subjectId: subject,
      subjectName: subject,
      subjectCode: null,
      teacherId: teacher,
      teacherName: teacher,
      staffCode: 'T',
    });
    installFetch(
      signedInAs(student(), {
        [`GET /timetable/students/${STUDENT}`]: () =>
          ok({
            studentId: STUDENT,
            placement: { ...section, enrolmentId: 'e1' },
            timetable: {
              academicYear: YEAR,
              workingDays: ['MON', 'TUE'],
              periods: [
                {
                  id: 'p1',
                  kind: 'LESSON',
                  label: 'Period 1',
                  periodNumber: 1,
                  startTime: '08:00',
                  endTime: '08:45',
                  status: 'ACTIVE',
                },
              ],
              section,
              published: {
                id: 'v',
                academicYearId: Y1,
                versionNumber: 1,
                status: 'PUBLISHED',
                entryCount: 2,
                createdAt: 't',
                createdBy: null,
                updatedAt: 't',
                updatedBy: null,
                publishedAt: 't',
                publishedBy: null,
                supersededAt: null,
              },
              entries: [
                entry(1, 'MON', 'TEST Maths', 'TEST Arun'),
                entry(2, 'TUE', 'TEST Maths', 'TEST Arun'),
              ],
            },
          }),
      }),
    );
    renderApp('/portal/timetable');
    const list = await screen.findByRole('list', { name: 'Subjects and teachers' });
    expect(list).toHaveTextContent('TEST Maths');
    expect(list).toHaveTextContent('TEST Arun');
    expect(list).toHaveTextContent('2 lessons a week');
  });

  it('behaviour and achievements: empty states, then published records', async () => {
    let behaviour: unknown[] = [];
    let achievements: unknown[] = [];
    installFetch(
      signedInAs(student(), {
        'GET /portal/behaviour': () => ok({ assessments: behaviour }),
        'GET /portal/achievements': () =>
          ok({ items: achievements, page: 1, pageSize: 500, total: achievements.length }),
      }),
    );
    const first = renderApp('/portal/behaviour');
    expect(
      await screen.findByText('No behaviour assessment has been published for you yet.'),
    ).toBeInTheDocument();
    first.unmount();
    const second = renderApp('/portal/achievements');
    expect(
      await screen.findByText('Your achievements will appear here once they are recorded.'),
    ).toBeInTheDocument();
    second.unmount();

    behaviour = [
      {
        academicYear: YEAR,
        exam,
        section,
        status: 'SUBMITTED',
        submittedAt: '2026-09-20T05:00:00.000Z',
        ratings: [
          { categoryId: CAT1, categoryName: 'TEST Discipline', rating: 4, label: 'TEST Good' },
        ],
        remark: 'Helpful',
      },
    ];
    achievements = [achievement()];
    const third = renderApp('/portal/behaviour');
    const card = await screen.findByRole('article', { name: 'Behaviour — TEST Mid Term' });
    expect(card).toHaveTextContent('TEST Discipline');
    expect(card).toHaveTextContent('4/5');
    expect(card).toHaveTextContent('TEST Good');
    expect(card).toHaveTextContent('Helpful');
    third.unmount();
    renderApp('/portal/achievements');
    const a = await screen.findByRole('article', { name: 'District 100 m — first place' });
    expect(a).toHaveTextContent('TEST Sports');
    expect(a).toHaveTextContent('15 Aug 2026');
  });

  it('staff cannot open the student pages; students cannot open staff pages', async () => {
    installFetch(signedInAs(classTeacher()));
    const one = renderApp('/portal/profile');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    one.unmount();
    installFetch(signedInAs(student()));
    renderApp('/behaviour');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});

describe('behaviour sheet (class teacher)', () => {
  const sheet = (extra: object = {}) => ({
    academicYear: YEAR,
    exam,
    section,
    categories: [
      { id: CAT1, name: 'TEST Discipline', description: null, active: true },
      { id: CAT2, name: 'TEST Teamwork', description: null, active: true },
    ],
    labels: [1, 2, 3, 4, 5].map((r) => ({ rating: r, label: `TEST L${r}` })),
    status: 'DRAFT',
    revision: 2,
    submitted: null,
    updatedAt: 't',
    rows: [
      {
        studentId: STUDENT,
        enrolmentId: 'e1',
        rollNumber: '7',
        admissionNumber: 'ADM-1',
        fullName: 'TEST Student One',
        onRoll: true,
        ratings: { [CAT1]: null, [CAT2]: null },
        remark: null,
        complete: false,
      },
    ],
    counts: { complete: 0, total: 1 },
    access: { canEdit: true, canSubmit: true, correction: false, readOnlyReason: null },
    ...extra,
  });
  const options = {
    years: [YEAR],
    academicYearId: Y1,
    exams: [exam],
    sections: [section],
    setupProblems: [],
  };

  it('columns come from the configured categories; save sends ratings; submit asks first', async () => {
    const bodies: Record<string, any[]> = { save: [], submit: [] };
    installFetch(
      signedInAs(classTeacher(), {
        'GET /behaviour/options': () => ok(options),
        'GET /behaviour/sheet': () => ok(sheet()),
        'PUT /behaviour/sheet': (init) => {
          bodies.save!.push(JSON.parse(String(init?.body)));
          return ok(
            sheet({
              revision: 3,
              rows: [
                {
                  ...sheet().rows[0],
                  ratings: { [CAT1]: 4, [CAT2]: 5 },
                  remark: 'Kind',
                  complete: true,
                },
              ],
              counts: { complete: 1, total: 1 },
            }),
          );
        },
        'POST /behaviour/sheet/submit': (init) => {
          bodies.submit!.push(JSON.parse(String(init?.body)));
          return ok(
            sheet({
              status: 'SUBMITTED',
              revision: 4,
              access: { canEdit: true, canSubmit: false, correction: true, readOnlyReason: null },
            }),
          );
        },
      }),
    );
    renderApp('/behaviour');
    const table = await screen.findByRole('table', { name: 'Behaviour' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Roll', 'Student', 'TEST Discipline', 'TEST Teamwork', 'Remark']);
    expect(screen.getByRole('button', { name: 'Submit behaviour' })).toBeDisabled();
    await userEvent.selectOptions(
      within(table).getByLabelText('TEST Discipline for TEST Student One'),
      '4',
    );
    await userEvent.selectOptions(
      within(table).getByLabelText('TEST Teamwork for TEST Student One'),
      '5',
    );
    await userEvent.type(within(table).getByLabelText('Remark for TEST Student One'), 'Kind');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(bodies.save).toHaveLength(1));
    expect(bodies.save![0]).toEqual({
      examId: EXAM,
      sectionId: SEC,
      revision: 2,
      rows: [
        {
          studentId: STUDENT,
          ratings: [
            { categoryId: CAT1, rating: 4 },
            { categoryId: CAT2, rating: 5 },
          ],
          remark: 'Kind',
        },
      ],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Submit behaviour' }));
    const confirm = await screen.findByRole('dialog', { name: 'Submit behaviour?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(bodies.submit).toEqual([{ examId: EXAM, sectionId: SEC, revision: 3 }]),
    );
    expect(await screen.findByText('Submitted · visible to students')).toBeInTheDocument();
  });

  it('a correction on a submitted sheet requires a reason', async () => {
    const bodies: any[] = [];
    const submitted = sheet({
      status: 'SUBMITTED',
      submitted: { at: 't', by: 'TEST CT' },
      rows: [{ ...sheet().rows[0], ratings: { [CAT1]: 4, [CAT2]: 5 }, complete: true }],
      counts: { complete: 1, total: 1 },
      access: { canEdit: true, canSubmit: false, correction: true, readOnlyReason: null },
    });
    installFetch(
      signedInAs(classTeacher(), {
        'GET /behaviour/options': () => ok(options),
        'GET /behaviour/sheet': () => ok(submitted),
        'PUT /behaviour/sheet': (init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return ok(submitted);
        },
      }),
    );
    renderApp('/behaviour');
    const table = await screen.findByRole('table', { name: 'Behaviour' });
    await userEvent.selectOptions(
      within(table).getByLabelText('TEST Discipline for TEST Student One'),
      '2',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Why is this being corrected?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    expect(within(dialog).getByText('Give a reason of at least 5 characters')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Wrong rating entered');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(bodies[0]).toMatchObject({ reason: 'Wrong rating entered' }));
  });
});

describe('achievements (staff)', () => {
  const options = {
    years: [{ ...YEAR, startDate: '2026-06-01', endDate: '2027-04-30' }],
    academicYearId: Y1,
    sections: [section],
    categories: [
      { id: uuid(6), name: 'TEST Sports', active: true },
      { id: uuid(7), name: 'TEST Old', active: false },
    ],
    canDelete: false,
  };
  it('adds an achievement after validating it, and archives after confirming', async () => {
    const bodies: any[] = [];
    const { calls } = installFetch(
      signedInAs(classTeacher(), {
        'GET /achievements/options': () => ok(options),
        'GET /achievements': () =>
          ok({ items: [achievement({ canManage: true })], page: 1, pageSize: 12, total: 1 }),
        'GET /admin/students': () =>
          ok({
            items: [
              {
                id: STUDENT,
                admissionNumber: 'ADM-1',
                fullName: 'TEST Student One',
                status: 'ACTIVE',
                exitReason: null,
                placement,
              },
            ],
            page: 1,
            pageSize: 50,
            total: 1,
            academicYearId: Y1,
          }),
        'POST /achievements': (init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return { status: 201, body: { data: achievement({ canManage: true }) } };
        },
        [`POST /achievements/${uuid(9)}/archive`]: () => ok(achievement({ status: 'ARCHIVED' })),
      }),
    );
    renderApp('/achievements');
    await screen.findByRole('article', { name: 'District 100 m — first place' });
    await userEvent.click(screen.getByRole('button', { name: 'Add achievement' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an achievement (TEST-2026)' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add achievement' }));
    expect(within(dialog).getByLabelText(/^Student/)).toHaveAttribute('aria-invalid', 'true');
    expect(bodies).toHaveLength(0);
    // Inactive categories are not offered.
    expect(within(dialog).queryByRole('option', { name: 'TEST Old' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByRole('option', { name: /TEST Student One \(ADM-1\)/ }),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Student/), STUDENT);
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Category/), uuid(6));
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Chess — school winner');
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '2026-09-01' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add achievement' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      studentId: STUDENT,
      academicYearId: Y1,
      categoryId: uuid(6),
      title: 'Chess — school winner',
      description: null,
      achievedOn: '2026-09-01',
    });

    await userEvent.click(await screen.findByRole('button', { name: /Archive District 100 m/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Archive this achievement?' });
    expect(confirm).toHaveTextContent('You can restore it later');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(calls).toContain(`POST /achievements/${uuid(9)}/archive`));
  });
});
