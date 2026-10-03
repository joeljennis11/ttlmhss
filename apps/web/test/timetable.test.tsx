// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads untyped request bodies */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { admin, installFetch, renderApp, signedInAs, user } from './support/render-app';

/*
 * Timetable UI (Phase 6). The network is stubbed with synthetic TEST data; the rules themselves
 * (conflicts, scope, publish) are covered by the API tests and the browser end-to-end tests.
 */
const ok = (data: unknown) => ({ status: 200, body: { data } });
const YEAR = {
  id: 'y1',
  label: 'TEST-2026',
  startDate: '2026-06-01',
  endDate: '2027-04-30',
  status: 'CURRENT',
  workingDays: ['MON', 'TUE'],
  inUse: true,
  updatedAt: 't',
};
const PERIODS = [
  {
    id: 'p1',
    kind: 'LESSON',
    periodNumber: 1,
    label: 'Period 1',
    startTime: '08:00',
    endTime: '08:45',
    status: 'ACTIVE',
  },
  {
    id: 'br',
    kind: 'BREAK',
    periodNumber: null,
    label: 'Break',
    startTime: '08:45',
    endTime: '09:00',
    status: 'ACTIVE',
  },
  {
    id: 'p2',
    kind: 'LESSON',
    periodNumber: 2,
    label: 'Period 2',
    startTime: '09:00',
    endTime: '09:45',
    status: 'ACTIVE',
  },
];
const SECTION = { sectionId: 's10a', sectionName: 'A', classId: 'c10', className: 'TEST-X' };
const version = (status: string, extra = {}) => ({
  id: `v-${status}`,
  academicYearId: 'y1',
  versionNumber: 1,
  status,
  entryCount: 1,
  createdAt: '2026-06-01T03:00:00.000Z',
  createdBy: 'test.admin',
  updatedAt: '2026-06-01T03:00:00.000Z',
  updatedBy: 'test.admin',
  publishedAt: status === 'DRAFT' ? null : '2026-06-01T04:00:00.000Z',
  publishedBy: status === 'DRAFT' ? null : 'test.admin',
  supersededAt: null,
  ...extra,
});
const MATHS = {
  id: 'e1',
  day: 'MON',
  periodId: 'p1',
  ...SECTION,
  subjectId: 'm',
  subjectName: 'Test Maths',
  subjectCode: null,
  teacherId: 't1',
  teacherName: 'Test Arun',
  staffCode: 'T1',
};
const editorView = (extra = {}) => ({
  academicYear: { id: 'y1', label: 'TEST-2026', status: 'CURRENT' },
  workingDays: ['MON', 'TUE'],
  periods: PERIODS,
  section: SECTION,
  draft: version('DRAFT'),
  published: null,
  entries: [MATHS],
  issues: [],
  canPublish: true,
  readOnlyYear: false,
  ...extra,
});
const OPTIONS = {
  sections: [SECTION],
  subjects: [
    { id: 'm', name: 'Test Maths', code: null },
    { id: 'en', name: 'Test English', code: null },
  ],
  teachers: [
    { id: 't1', fullName: 'Test Arun', staffCode: 'T1', subjectIds: ['m'] },
    { id: 't2', fullName: 'Test Priya', staffCode: 'T2', subjectIds: ['en'] },
  ],
};
const editorHandlers = (extra = {}) => ({
  'GET /timetable/years': () => ok({ items: [YEAR] }),
  'GET /timetable/years/y1/options': () => ok(OPTIONS),
  'GET /timetable/years/y1/editor': () => ok(editorView()),
  'GET /timetable/years/y1/versions': () => ok({ items: [version('DRAFT')] }),
  ...extra,
});

describe('timetable editor', () => {
  it('shows the configured week: periods with times, breaks, lessons and free periods', async () => {
    installFetch(signedInAs(admin(), editorHandlers()));
    renderApp('/timetable/edit');
    const grid = await screen.findByRole('table', { name: /Draft timetable of TEST-X A/ });
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Day',
      'Period 108:00–08:45',
      'Break08:45–09:00',
      'Period 209:00–09:45',
    ]);
    expect(within(grid).getByRole('rowheader', { name: 'Monday' })).toBeInTheDocument();
    expect(
      within(grid).getByRole('button', { name: /Test Maths, Test Arun, Monday, Period 1/ }),
    ).toBeInTheDocument();
    expect(within(grid).getAllByRole('button', { name: /^Free — add a lesson/ })).toHaveLength(3);
    expect(await screen.findByRole('table', { name: 'Timetable versions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  it('adds a lesson: only teachers of the subject are offered; the server validates before it shows', async () => {
    const bodies: any[] = [];
    const { calls } = installFetch(
      signedInAs(
        admin(),
        editorHandlers({
          'POST /timetable/years/y1/draft/changes': (init: RequestInit | undefined) => {
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            const created = body.operations[0];
            return ok(
              editorView({
                entries: [
                  MATHS,
                  {
                    ...MATHS,
                    id: created.id,
                    day: 'TUE',
                    periodId: 'p2',
                    subjectId: 'en',
                    subjectName: 'Test English',
                    teacherId: 't2',
                    teacherName: 'Test Priya',
                  },
                ],
              }),
            );
          },
        }),
      ),
    );
    renderApp('/timetable/edit');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Free — add a lesson on Tuesday, Period 2' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add lesson' });
    const teacher = within(dialog).getByLabelText(/^Teacher/);
    expect(teacher).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Subject/), 'en');
    expect(
      within(teacher)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose…', 'Test Priya (T2)']);
    await userEvent.selectOptions(teacher, 't2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add lesson' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      sectionId: 's10a',
      dryRun: true,
      operations: [
        {
          op: 'create',
          day: 'TUE',
          periodId: 'p2',
          sectionId: 's10a',
          subjectId: 'en',
          teacherId: 't2',
        },
      ],
    });
    expect(await screen.findByText('1 unsaved change')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Test English, Test Priya, Tuesday, Period 2/ }),
    ).toHaveTextContent('Unsaved');

    // Save draft sends the same changes for real.
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ dryRun: false, operations: bodies[0].operations });
    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith('POST')).length).toBe(2);
  });

  it('a refused change shows the server message and changes nothing', async () => {
    installFetch(
      signedInAs(
        admin(),
        editorHandlers({
          'POST /timetable/years/y1/draft/changes': () => ({
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: 'Test Arun already teaches TEST-X B (Test Maths) on Monday, Period 2.',
                details: [{ path: 'body.operations.0.teacherId', message: 'x' }],
              },
            },
          }),
        }),
      ),
    );
    renderApp('/timetable/edit');
    await userEvent.click(
      await screen.findByRole('button', { name: /Test Maths, Test Arun, Monday, Period 1/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: /Edit lesson/ });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Period/), 'p2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply change' }));
    expect(await within(dialog).findByText(/already teaches TEST-X B/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ unsaved changes?$/)).not.toBeInTheDocument();
  });

  it('removing asks first; publishing lists the problems the server reports', async () => {
    installFetch(
      signedInAs(
        admin(),
        editorHandlers({
          'POST /timetable/years/y1/draft/publish': () => ({
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: 'The timetable was not published: 1 lesson needs attention.',
                details: [
                  {
                    path: 'entries.e1',
                    message: 'TEST-X A, Monday, Period 1: Test Arun is inactive.',
                  },
                ],
              },
            },
          }),
        }),
      ),
    );
    renderApp('/timetable/edit');
    await userEvent.click(
      await screen.findByRole('button', { name: /Test Maths, Test Arun, Monday, Period 1/ }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: /Edit lesson/ })).getByRole('button', {
        name: 'Remove lesson',
      }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Remove lesson?' });
    expect(confirm).toHaveTextContent('Remove Test Maths from TEST-X A, Monday Period 1?');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Publish timetable' }));
    await userEvent.click(
      within(
        await screen.findByRole('dialog', { name: /Publish the TEST-2026 timetable/ }),
      ).getByRole('button', { name: 'Publish' }),
    );
    expect(
      await screen.findByText('TEST-X A, Monday, Period 1: Test Arun is inactive.'),
    ).toBeInTheDocument();
  });

  it('without a draft the live timetable is read-only and editing starts a draft', async () => {
    const { calls } = installFetch(
      signedInAs(
        admin(),
        editorHandlers({
          'GET /timetable/years/y1/editor': () =>
            ok(editorView({ draft: null, published: version('PUBLISHED') })),
          'POST /timetable/years/y1/draft': () => ({
            status: 201,
            body: { data: version('DRAFT', { versionNumber: 2 }) },
          }),
        }),
      ),
    );
    renderApp('/timetable/edit');
    const grid = await screen.findByRole('table', { name: /Published timetable of TEST-X A/ });
    expect(within(grid).queryByRole('button')).not.toBeInTheDocument();
    expect(within(grid).getAllByText('Free')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Edit timetable (new draft)' }));
    await waitFor(() => expect(calls).toContain('POST /timetable/years/y1/draft'));
  });

  it('teachers without editing rights get "no access" and no Edit tab', async () => {
    installFetch(
      signedInAs(user({ permissions: ['timetable.view', 'config.view'] }), {
        'GET /timetable/years': () => ok({ items: [YEAR] }),
      }),
    );
    renderApp('/timetable/edit');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});

describe('timetable views', () => {
  it("a teacher's own week lists their classes from the published timetable", async () => {
    installFetch(
      signedInAs(user({ permissions: ['timetable.view', 'config.view'] }), {
        'GET /timetable/years': () => ok({ items: [YEAR] }),
        'GET /timetable/me': () =>
          ok({
            academicYear: { id: 'y1', label: 'TEST-2026', status: 'CURRENT' },
            workingDays: ['MON', 'TUE'],
            periods: PERIODS,
            teacher: { id: 't1', fullName: 'Test Arun', staffCode: 'T1' },
            published: version('PUBLISHED'),
            entries: [MATHS],
          }),
      }),
    );
    renderApp('/timetable');
    const grid = await screen.findByRole('table', { name: 'Timetable of Test Arun, TEST-2026' });
    expect(within(grid).getByText('TEST-X A')).toBeInTheDocument();
    expect(within(grid).getByText('Test Maths')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Timetable' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['My timetable', 'Class timetables']);
  });

  it('a class timetable that is not published says so (no invented lessons)', async () => {
    installFetch(
      signedInAs(admin(), {
        'GET /timetable/years': () => ok({ items: [YEAR] }),
        'GET /timetable/years/y1/sections': () => ok({ items: [SECTION] }),
        'GET /timetable/years/y1/sections/s10a': () =>
          ok({
            academicYear: { id: 'y1', label: 'TEST-2026', status: 'CURRENT' },
            workingDays: ['MON', 'TUE'],
            periods: PERIODS,
            section: SECTION,
            published: null,
            entries: [],
          }),
      }),
    );
    renderApp('/timetable/classes');
    expect(await screen.findByText('Not published yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('no configured periods is explained instead of an empty grid', async () => {
    installFetch(
      signedInAs(admin(), {
        'GET /timetable/years': () => ok({ items: [YEAR] }),
        'GET /timetable/years/y1/sections': () => ok({ items: [SECTION] }),
        'GET /timetable/years/y1/sections/s10a': () =>
          ok({
            academicYear: { id: 'y1', label: 'TEST-2026', status: 'CURRENT' },
            workingDays: ['MON'],
            periods: [],
            section: SECTION,
            published: version('PUBLISHED'),
            entries: [],
          }),
      }),
    );
    renderApp('/timetable/classes');
    expect(await screen.findByText('No periods configured')).toBeInTheDocument();
  });
});
