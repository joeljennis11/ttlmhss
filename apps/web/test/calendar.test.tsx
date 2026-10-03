// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads untyped request bodies */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { admin, installFetch, renderApp, signedInAs, user } from './support/render-app';

/*
 * Academic calendar UI (Phase 8A). Network stubbed with synthetic TEST data. The year lies in the
 * past so the page always opens on its first month (June 2020): Fri 5 June, Sat 6 June.
 */
const ok = (data: unknown) => ({ status: 200, body: { data } });
const YEAR = {
  id: 'y1',
  label: 'TEST-2020',
  startDate: '2020-06-01',
  endDate: '2021-04-30',
  status: 'CURRENT',
  workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  inUse: true,
  updatedAt: 't',
};
const cls = (id: string, name: string, order: number) => ({
  id,
  name,
  displayOrder: order,
  active: true,
  sections: [{ id: `${id}-a`, name: 'A', active: true }],
});
const CLASSES = [
  cls('00000000-0000-4000-8000-000000000001', 'PreKG', 1),
  cls('00000000-0000-4000-8000-000000000002', '1', 2),
  cls('00000000-0000-4000-8000-000000000003', '2', 3),
  cls('00000000-0000-4000-8000-000000000010', '10', 4),
  cls('00000000-0000-4000-8000-000000000011', '11', 5),
  cls('00000000-0000-4000-8000-000000000012', '12', 6),
];
const entry = (extra: object) => ({
  academicYearId: 'y1',
  classes: [],
  sections: [],
  note: null,
  createdAt: 't',
  createdBy: 'test.admin',
  updatedAt: 't',
  updatedBy: 'test.admin',
  ...extra,
});
const HOLIDAY = entry({
  id: 'e1',
  date: '2020-06-05',
  day: 'FRI',
  status: 'HOLIDAY',
  scope: 'SCHOOL',
  appliesTo: 'Entire school',
  weeklyWorking: true,
  reason: 'Test holiday',
});
const SPECIAL = entry({
  id: 'e2',
  date: '2020-06-06',
  day: 'SAT',
  status: 'WORKING',
  scope: 'CLASSES',
  classes: [
    { id: '00000000-0000-4000-8000-000000000011', name: '11' },
    { id: '00000000-0000-4000-8000-000000000012', name: '12' },
  ],
  appliesTo: 'Classes 11, 12',
  weeklyWorking: false,
  reason: 'Special class',
});
const view = (entries: object[]) => ({
  academicYear: {
    id: 'y1',
    label: 'TEST-2020',
    status: 'CURRENT',
    startDate: '2020-06-01',
    endDate: '2021-04-30',
    workingDays: YEAR.workingDays,
  },
  readOnly: false,
  entries,
  classes: CLASSES,
});
const handlers = (extra = {}) => ({
  'GET /admin/academic-years': () => ok([YEAR]),
  'GET /admin/academic-years/y1/calendar': () => ok(view([HOLIDAY, SPECIAL])),
  ...extra,
});

describe('academic calendar page', () => {
  it('shows the weekly pattern, the month with holidays and special days, and the entry list', async () => {
    installFetch(signedInAs(admin(), handlers()));
    renderApp('/admin/academic-calendar');
    const grid = await screen.findByRole('table', { name: 'Calendar for June 2020' });
    expect(screen.getByText('Monday, Tuesday, Wednesday, Thursday, Friday')).toBeInTheDocument();
    // Status is written in words (never colour alone).
    const fri = within(grid).getByRole('button', {
      name: /Holiday, Entire school, Test holiday, 5 June 2020/,
    });
    expect(fri).toHaveTextContent('Holiday');
    expect(
      within(grid).getByRole('button', {
        name: /Special working day, Classes 11, 12, Special class, 6 June 2020/,
      }),
    ).toBeInTheDocument();
    expect(within(grid).getAllByText('Closed').length).toBeGreaterThan(0);
    const list = screen.getByRole('table', { name: 'Calendar entries for TEST-2020' });
    expect(
      within(list)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual([
      expect.stringContaining('Date'),
      expect.stringContaining('Entire school'),
      expect.stringContaining('Classes 11, 12'),
    ]);
  });

  it('a class range uses the configured class order and sends explicit classes', async () => {
    const bodies: any[] = [];
    installFetch(
      signedInAs(
        admin(),
        handlers({
          'POST /admin/academic-years/y1/calendar': (init: RequestInit | undefined) => {
            bodies.push(JSON.parse(String(init?.body)));
            return { status: 201, body: { data: view([HOLIDAY, SPECIAL]) } };
          },
        }),
      ),
    );
    renderApp('/admin/academic-calendar');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add an entry on 13 June 2020' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add calendar entry' });
    // Saturday → defaults to a special working day; the hint explains the weekly pattern.
    expect(within(dialog).getByLabelText(/^Status/)).toHaveValue('WORKING');
    expect(within(dialog).getByText('Saturday — normally closed.')).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Applies to/), 'RANGE');
    await userEvent.selectOptions(
      within(dialog).getByLabelText('From class'),
      '00000000-0000-4000-8000-000000000003',
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText('To class'),
      '00000000-0000-4000-8000-000000000011',
    );
    expect(
      within(dialog).getByText('Includes 2, 10, 11 (in the configured class order).'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Extra class');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add entry' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      date: '2020-06-13',
      status: 'WORKING',
      scope: 'CLASSES',
      classIds: [
        '00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
      ],
      sectionIds: [],
      reason: 'Extra class',
    });
    expect(await screen.findByText('Working day on 13 Jun 2020 added')).toBeInTheDocument();
  });

  it('a refused overlap is explained in the dialog; a missing reason is caught before sending', async () => {
    const { calls } = installFetch(
      signedInAs(
        admin(),
        handlers({
          'POST /admin/academic-years/y1/calendar': () => ({
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: 'Overlap',
                details: [
                  {
                    path: 'body.scope',
                    message: '2020-06-05 already has "Holiday — Entire school" (Test holiday).',
                  },
                ],
              },
            },
          }),
        }),
      ),
    );
    renderApp('/admin/academic-calendar');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add an entry on 5 June 2020' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add calendar entry' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add entry' }));
    expect(within(dialog).getByText('Reason is required')).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Another');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add entry' }));
    expect(
      await within(dialog).findByText(/already has "Holiday — Entire school"/),
    ).toBeInTheDocument();
  });

  it('closing with unsaved changes asks first; delete asks and explains attendance is kept', async () => {
    const { calls } = installFetch(
      signedInAs(
        admin(),
        handlers({ 'DELETE /admin/calendar-entries/e1': () => ok(view([SPECIAL])) }),
      ),
    );
    renderApp('/admin/academic-calendar');
    const grid = await screen.findByRole('table', { name: 'Calendar for June 2020' });
    await userEvent.click(within(grid).getByRole('button', { name: /Holiday, Entire school/ }));
    const dialog = await screen.findByRole('dialog', { name: /Edit entry — 5 Jun 2020/ });
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), ' (moved)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByRole('dialog', { name: 'Discard your changes?' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    const list = screen.getByRole('table', { name: 'Calendar entries for TEST-2020' });
    await userEvent.click(within(list).getByRole('button', { name: /Delete Test holiday/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this calendar entry?' });
    expect(confirm).toHaveTextContent('Attendance already saved is not changed');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete entry' }));
    await waitFor(() => expect(calls).toContain('DELETE /admin/calendar-entries/e1'));
    expect(await screen.findByText('Holiday on 5 Jun 2020 removed')).toBeInTheDocument();
  });

  it('teachers get no calendar page', async () => {
    installFetch(signedInAs(user()));
    renderApp('/admin/academic-calendar');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});
