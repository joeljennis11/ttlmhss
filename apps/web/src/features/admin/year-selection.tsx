import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AcademicYearView } from '@ttlmhss/shared';
import { CalendarRange } from 'lucide-react';
import { Panel } from '../../components/layout/Page';
import { EmptyState, ErrorState, LoadingState, SelectField } from '../../components/ui';
import { useResource } from '../../lib/use-resource';
import { adminHref } from './admin-pages';
import { academicYears } from './api';

/**
 * The academic year a page is working on. Kept in the address (?year=…) so a reload or a shared
 * link opens the same year. Defaults to the current year, then the most recent one.
 */
export function useYearSelection() {
  const years = useResource('academic-years', (signal) => academicYears.list(signal));
  const [params, setParams] = useSearchParams();
  const requested = params.get('year');

  let year: AcademicYearView | null = null;
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
  years: readonly AcademicYearView[];
  year: AcademicYearView;
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

/** Loading / error / "add a year first" states shared by pages that work per academic year. */
export function YearGate({
  selection,
  children,
}: {
  selection: ReturnType<typeof useYearSelection>;
  children: (year: AcademicYearView, years: readonly AcademicYearView[]) => ReactNode;
}) {
  const { years, year } = selection;
  if (years.status === 'loading') return <LoadingState />;
  if (years.status === 'error') return <ErrorState message={years.error} onRetry={years.reload} />;
  if (!year) {
    return (
      <Panel>
        <EmptyState
          icon={CalendarRange}
          title="Add an academic year first"
          action={<Link to={adminHref('years')}>Go to academic years</Link>}
        >
          This is set up separately for each academic year.
        </EmptyState>
      </Panel>
    );
  }
  return <>{children(year, years.data)}</>;
}
