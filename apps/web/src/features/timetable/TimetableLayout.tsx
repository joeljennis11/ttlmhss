import type { ReactNode } from 'react';
import { Navigate, NavLink, useSearchParams } from 'react-router';
import { Weekday, type AuthUser, type TimetableYearList } from '@ttlmhss/shared';
import { CalendarRange } from 'lucide-react';
import { usePageTitle } from '../../app/page-meta';
import { PageHeader, Panel } from '../../components/layout/Page';
import { EmptyState, ErrorState, LoadingState, SelectField } from '../../components/ui';
import { useResource } from '../../lib/use-resource';
import { canAccessRoute } from '../../shell/navigation';
import { useAuth } from '../auth/auth-context';
import admin from '../admin/admin.module.css';
import { timetableApi } from './api';
import styles from './timetable.module.css';

/** The timetable pages and who may open them (UX only — the API enforces the same rules). */
export const TIMETABLE_PAGES = [
  { path: 'timetable/my', label: 'My timetable', roles: ['TEACHER'] as const },
  {
    path: 'timetable/classes',
    label: 'Class timetables',
    permission: 'timetable.view' as const,
    roles: ['ADMIN', 'TEACHER'] as const,
  },
  { path: 'timetable/edit', label: 'Edit timetable', permission: 'timetable.manage' as const },
  {
    path: 'timetable/requests',
    label: 'Requests',
    permission: 'timetable.view' as const,
    roles: ['ADMIN', 'CLASS_TEACHER'] as const,
  },
] as const;

function pagesFor(user: Pick<AuthUser, 'permissions' | 'roles'>) {
  return TIMETABLE_PAGES.filter((p) => canAccessRoute(user, p));
}

/** /timetable opens the first timetable page this user can use. */
export function TimetableHome() {
  const { user } = useAuth();
  const first = user ? pagesFor(user)[0] : undefined;
  return first ? <Navigate to={`/${first.path}`} replace /> : null;
}

export function TimetableLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  usePageTitle(title);
  const { user } = useAuth();
  const pages = user ? pagesFor(user) : [];
  return (
    <>
      {pages.length > 1 && (
        <nav aria-label="Timetable" className={admin.subnav}>
          <ul>
            {pages.map((p) => (
              <li key={p.path}>
                <NavLink
                  to={`/${p.path}`}
                  className={({ isActive }) =>
                    isActive ? `${admin.subLink} ${admin.subActive}` : admin.subLink
                  }
                >
                  {p.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <PageHeader title={title} description={description} />
      <div className={styles.stack}>{children}</div>
    </>
  );
}

export type TimetableYear = TimetableYearList['items'][number];

/**
 * The academic year a timetable page shows. Kept in the address (?year=…) so a reload or a shared
 * link opens the same year. Defaults to the current year, then the most recent one.
 */
export function useTimetableYear() {
  const years = useResource('tt-years', (signal) =>
    timetableApi.years(signal).then((list) => list.items),
  );
  const [params, setParams] = useSearchParams();
  const requested = params.get('year');
  let year: TimetableYear | null = null;
  if (years.status === 'ready') {
    year =
      years.data.find((y) => y.id === requested) ??
      years.data.find((y) => y.status === 'CURRENT') ??
      years.data[0] ??
      null;
  }
  const select = (id: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('year', id);
        next.delete('section');
        return next;
      },
      { replace: true },
    );
  return { years, year, select };
}

export function YearSelect({
  years,
  year,
  onChange,
}: {
  years: readonly TimetableYear[];
  year: TimetableYear;
  onChange: (id: string) => void;
}) {
  return (
    <SelectField
      label="Academic year"
      value={year.id}
      onChange={(e) => onChange(e.target.value)}
      options={years.map((y) => ({
        value: y.id,
        label: y.status === 'CURRENT' ? `${y.label} (current)` : y.label,
      }))}
    />
  );
}

/** Loading / error / "no academic year" for pages that work per year. */
export function TimetableYearGate({
  selection,
  children,
}: {
  selection: ReturnType<typeof useTimetableYear>;
  children: (year: TimetableYear, years: readonly TimetableYear[]) => ReactNode;
}) {
  const { years, year } = selection;
  if (years.status === 'loading') return <LoadingState />;
  if (years.status === 'error') return <ErrorState message={years.error} onRetry={years.reload} />;
  if (!year) {
    return (
      <Panel>
        <EmptyState icon={CalendarRange} title="No academic year yet">
          Timetables belong to an academic year. An administrator adds years in School setup.
        </EmptyState>
      </Panel>
    );
  }
  return <>{children(year, years.data)}</>;
}

/** Today's weekday in the school's time zone (to mark "Today" in the current year). */
export function todayWeekday(): Weekday | null {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Asia/Kolkata' })
    .format(new Date())
    .toUpperCase()
    .slice(0, 3);
  return Weekday.is(day) ? day : null;
}
