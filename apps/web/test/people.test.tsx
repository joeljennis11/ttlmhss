// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads untyped request bodies */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { admin, installFetch, renderApp, signedInAs, user } from './support/render-app';

/*
 * Student & teacher management UI (Phase 5). The network is stubbed with synthetic TEST data;
 * the API rules themselves are covered by the API tests and the browser end-to-end tests.
 */
const ok = (data: unknown) => ({ status: 200, body: { data } });
const YEAR = {
  id: 'y1',
  label: 'TEST-2026',
  startDate: '2026-06-01',
  endDate: '2027-04-30',
  status: 'CURRENT',
  workingDays: null,
  inUse: true,
  updatedAt: 't',
};
const NEXT = {
  ...YEAR,
  id: 'y2',
  label: 'TEST-2027',
  startDate: '2027-06-01',
  endDate: '2028-04-30',
  status: 'UPCOMING',
};
const CLASSES = [
  {
    id: 'c9',
    name: 'TEST-IX',
    displayOrder: 9,
    status: 'ACTIVE',
    sections: [
      { id: 's9a', classId: 'c9', name: 'A', status: 'ACTIVE' },
      { id: 's9b', classId: 'c9', name: 'B', status: 'ACTIVE' },
    ],
  },
  {
    id: 'c10',
    name: 'TEST-X',
    displayOrder: 10,
    status: 'ACTIVE',
    sections: [{ id: 's10a', classId: 'c10', name: 'A', status: 'ACTIVE' }],
  },
];
const placement = (extra = {}) => ({
  enrolmentId: 'e1',
  academicYearId: 'y1',
  academicYearLabel: 'TEST-2026',
  classId: 'c9',
  className: 'TEST-IX',
  sectionId: 's9a',
  sectionName: 'A',
  rollNumber: '1',
  status: 'ACTIVE',
  startedOn: '2026-06-01',
  endedOn: null,
  ...extra,
});
const STUDENT = {
  id: '11111111-1111-4111-8111-111111111111',
  admissionNumber: 'T/001',
  admissionDate: '2026-06-01',
  fullName: 'Test Student One',
  dateOfBirth: null,
  gender: null,
  fatherName: 'Test Father',
  motherName: null,
  guardianName: null,
  guardianRelation: null,
  guardianPhone: null,
  phone: null,
  email: null,
  emergencyPhone: null,
  address: null,
  city: null,
  state: null,
  pincode: null,
  photoPath: null,
  status: 'ACTIVE',
  exitReason: null,
  exitDate: null,
  current: placement(),
  history: [placement()],
  account: {
    userId: 'u9',
    username: 't-001',
    status: 'ACTIVE',
    mustChangePassword: true,
    lastLoginAt: null,
  },
  deletable: true,
  createdAt: 't',
  updatedAt: 't',
};
const structure = {
  'GET /admin/academic-years': () => ok([YEAR, NEXT]),
  'GET /admin/classes': () => ok(CLASSES),
};

describe('people management access', () => {
  it('teachers get no Management menu and "no access" on the pages', async () => {
    installFetch(signedInAs(user()));
    renderApp('/students');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Students' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Teachers' })).not.toBeInTheDocument();
  });
});

describe('students', () => {
  it('lists students from the server and pages with the server', async () => {
    const { calls } = installFetch(
      signedInAs(admin(), {
        ...structure,
        'GET /admin/students': () =>
          ok({
            items: [
              {
                id: STUDENT.id,
                admissionNumber: 'T/001',
                fullName: 'Test Student One',
                status: 'ACTIVE',
                exitReason: null,
                placement: placement(),
              },
            ],
            page: 1,
            pageSize: 25,
            total: 30,
            academicYearId: 'y1',
          }),
      }),
    );
    renderApp('/students');
    expect(await screen.findByRole('link', { name: 'Test Student One' })).toBeInTheDocument();
    expect(screen.getByText('Showing 1–25 of 30 students')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(calls.some((c) => c.includes('/admin/students?') && c.includes('page=2'))).toBe(true),
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'LEFT_SCHOOL');
    await waitFor(() => expect(calls.some((c) => c.includes('status=LEFT_SCHOOL'))).toBe(true));
  });

  it('admission: checks required fields first, then shows server conflicts next to the field', async () => {
    const { calls } = installFetch(
      signedInAs(admin(), {
        ...structure,
        'POST /admin/students': () => ({
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message: 'Admission number T/001 is already used by another student.',
              details: [
                {
                  path: 'body.admissionNumber',
                  message: 'Admission number T/001 is already used by another student.',
                },
              ],
            },
          },
        }),
      }),
    );
    renderApp('/students/new');
    const submit = await screen.findByRole('button', { name: 'Admit student' });
    await userEvent.click(submit);
    expect(await screen.findByText('Admission number is required')).toBeInTheDocument();
    expect(calls).not.toContain('POST /admin/students');

    await userEvent.type(screen.getByLabelText(/Admission number/), 'T/001');
    await userEvent.type(screen.getByLabelText(/Admission date/), '2026-06-01');
    await userEvent.selectOptions(screen.getByLabelText(/Class and section/), 's9a');
    await userEvent.type(screen.getByLabelText(/Full name/), 'Test Student Two');
    await userEvent.click(submit);
    expect(
      await screen.findByText('Admission number T/001 is already used by another student.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Admission number/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('profile: a temporary password is shown once and disappears when done', async () => {
    installFetch(
      signedInAs(admin(), {
        ...structure,
        [`GET /admin/students/${STUDENT.id}`]: () => ok(STUDENT),
        [`POST /admin/students/${STUDENT.id}/temporary-password`]: () =>
          ok({ username: 't-001', temporaryPassword: 'Test-temp-123' }),
      }),
    );
    renderApp(`/students/${STUDENT.id}`);
    expect(await screen.findByText('TEST-IX A', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('First sign-in pending')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Issue temporary password' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Issue password' }),
    );
    expect(await screen.findByTestId('temporary-password')).toHaveTextContent('Test-temp-123');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Test-temp-123')).not.toBeInTheDocument();
  });

  it('promotion: per-student outcomes are reviewed and sent together', async () => {
    let sent: any = null;
    installFetch(
      signedInAs(admin(), {
        ...structure,
        'GET /admin/promotions/candidates': () =>
          ok([
            {
              studentId: 'a',
              admissionNumber: 'T/001',
              fullName: 'Test A',
              rollNumber: '1',
              targetPlacement: null,
            },
            {
              studentId: 'b',
              admissionNumber: 'T/002',
              fullName: 'Test B',
              rollNumber: '2',
              targetPlacement: null,
            },
          ]),
        'POST /admin/promotions': (init) => {
          sent = JSON.parse(String(init?.body));
          return ok({ promoted: 1, notPromoted: 0, transferred: 0, left: 1 });
        },
      }),
    );
    renderApp('/students/promotion');
    await userEvent.selectOptions(await screen.findByLabelText('Class and section'), 's9a');
    expect(await screen.findByText('Test A')).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText('Next class for all promoted students'),
      's10a',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply to promoted' }));
    await userEvent.selectOptions(screen.getByLabelText('Outcome for Test B'), 'LEFT');
    await userEvent.click(screen.getByRole('button', { name: 'Review 2 students' }));
    const confirm = await screen.findByRole('dialog', { name: 'Confirm promotion' });
    expect(within(confirm).getByText('Promoted: 1')).toBeInTheDocument();
    expect(within(confirm).getByText('Left school: 1')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Promote now' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toMatchObject({
      sourceAcademicYearId: 'y1',
      sourceSectionId: 's9a',
      targetAcademicYearId: 'y2',
      decisions: [
        { studentId: 'a', outcome: 'PROMOTED', targetSectionId: 's10a', rollNumber: '1' },
        { studentId: 'b', outcome: 'LEFT', targetSectionId: null, rollNumber: null },
      ],
    });
    expect(await screen.findByRole('heading', { name: 'Done' })).toBeInTheDocument();
  });
});

describe('teachers', () => {
  it('assigns a subject from the subject list', async () => {
    const TEACHER = {
      id: '22222222-2222-4222-8222-222222222222',
      staffCode: 'TST-1',
      fullName: 'Test Teacher',
      gender: null,
      dateOfBirth: null,
      phone: null,
      email: null,
      address: null,
      designation: null,
      qualification: null,
      joiningDate: null,
      status: 'ACTIVE',
      subjects: [],
      classTeacherAssignments: [],
      account: {
        userId: 'u1',
        username: 'tst-1',
        status: 'ACTIVE',
        mustChangePassword: false,
        lastLoginAt: '2026-06-02T09:00:00.000Z',
      },
      deletable: false,
      createdAt: 't',
      updatedAt: 't',
    };
    const SUBJECT = { id: 'm1', name: 'Test Maths', code: null, displayOrder: 1, status: 'ACTIVE' };
    let posts = 0;
    installFetch(
      signedInAs(admin(), {
        ...structure,
        'GET /admin/subjects': () => ok([SUBJECT]),
        [`GET /admin/teachers/${TEACHER.id}`]: () => ok(TEACHER),
        [`POST /admin/teachers/${TEACHER.id}/subjects`]: () => {
          posts++;
          return posts === 1
            ? ok({
                ...TEACHER,
                subjects: [{ id: 'm1', name: 'Test Maths', code: null, status: 'ACTIVE' }],
              })
            : {
                status: 409,
                body: {
                  error: { code: 'CONFLICT', message: 'Test Teacher already teaches Test Maths.' },
                },
              };
        },
      }),
    );
    renderApp(`/teachers/${TEACHER.id}`);
    await screen.findByRole('option', { name: 'Test Maths' });
    await userEvent.selectOptions(screen.getByLabelText('Add a subject'), 'm1');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const chips = await screen.findByRole('list', { name: 'Assigned subjects' });
    expect(within(chips).getByText('Test Maths')).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Remove Test Maths' })).toBeInTheDocument();
    expect(screen.getByText('No more subjects')).toBeInTheDocument();
  });
});
