import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { TimetablePeriodView, TimetableVersionView, Weekday } from '@ttlmhss/shared';
import { CalendarDays, Clock, Layers } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import { Badge, EmptyState, ErrorState, LoadingState, SelectField } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { useResource } from '../../../lib/use-resource';
import { useAuth } from '../../auth/auth-context';
import { TodayLessons } from '../../attendance/LessonList';
import { timetableApi } from '../api';
import {
  TimetableLayout,
  TimetableYearGate,
  YearSelect,
  todayWeekday,
  useTimetableYear,
} from '../TimetableLayout';
import { WeekGrid } from '../WeekGrid';
import styles from '../timetable.module.css';

/** "No periods / no working days" — the timetable needs the configured school week. */
export function frameNotice(
  periods: readonly TimetablePeriodView[],
  workingDays: readonly Weekday[],
  yearLabel: string,
): ReactNode {
  if (!periods.some((p) => p.kind === 'LESSON')) {
    return (
      <EmptyState icon={Clock} title="No periods configured">
        The school day for {yearLabel} has no teaching periods yet. An administrator sets them in
        School setup → Periods & breaks.
      </EmptyState>
    );
  }
  if (workingDays.length === 0) {
    return (
      <EmptyState icon={CalendarDays} title="Working days not set">
        The working days of {yearLabel} are not set yet. An administrator sets them in School setup
        → Academic years.
      </EmptyState>
    );
  }
  return null;
}

export function PublishedLine({ version }: { version: TimetableVersionView | null }) {
  if (!version) return null;
  return (
    <p className={styles.hint}>
      <Badge tone="active">Published</Badge> Version {version.versionNumber}
      {version.publishedAt ? `, published ${formatDateTime(version.publishedAt)}` : ''}
      {version.publishedBy ? ` by ${version.publishedBy}` : ''}.
    </p>
  );
}

const isCurrent = (status: string) => status === 'CURRENT';

/** The signed-in teacher's published week, across all their classes. */
export function MyTimetablePage() {
  const selection = useTimetableYear();
  const { user } = useAuth();
  const canTakeAttendance = user?.permissions.includes('attendance.mark') ?? false;
  return (
    <TimetableLayout
      title="My timetable"
      description="Your lessons this academic year, from the published timetable."
    >
      <TimetableYearGate selection={selection}>
        {(year, years) => (
          <>
            <div className={styles.toolbar}>
              <YearSelect years={years} year={year} onChange={selection.select} />
            </div>
            {isCurrent(year.status) && canTakeAttendance && <TodayLessons />}
            <MyWeek yearId={year.id} yearLabel={year.label} current={isCurrent(year.status)} />
          </>
        )}
      </TimetableYearGate>
    </TimetableLayout>
  );
}

function MyWeek({
  yearId,
  yearLabel,
  current,
}: {
  yearId: string;
  yearLabel: string;
  current: boolean;
}) {
  const view = useResource(`tt-me:${yearId}`, (signal) => timetableApi.myTimetable(yearId, signal));
  if (view.status === 'loading') return <LoadingState />;
  if (view.status === 'error') return <ErrorState message={view.error} onRetry={view.reload} />;
  const t = view.data;
  const notice = frameNotice(t.periods, t.workingDays, yearLabel);
  return (
    <Panel>
      {!t.published ? (
        <EmptyState icon={CalendarDays} title="No published timetable yet">
          The {yearLabel} timetable has not been published. Your lessons appear here once it is.
        </EmptyState>
      ) : (
        (notice ?? (
          <div className={styles.stack}>
            <PublishedLine version={t.published} />
            {t.entries.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No lessons for you">
                You have no lessons in the published {yearLabel} timetable.
              </EmptyState>
            ) : (
              <WeekGrid
                periods={t.periods}
                workingDays={t.workingDays}
                entries={t.entries}
                show="class"
                caption={`Timetable of ${t.teacher.fullName}, ${yearLabel}`}
                today={current ? todayWeekday() : null}
              />
            )}
          </div>
        ))
      )}
    </Panel>
  );
}

/** Published timetable of a class/section the user may see. */
export function ClassTimetablePage() {
  const selection = useTimetableYear();
  return (
    <TimetableLayout
      title="Class timetables"
      description="The published timetable of each class and section. Every view is built from the same published timetable."
    >
      <TimetableYearGate selection={selection}>
        {(year, years) => (
          <ClassPicker
            key={year.id}
            yearId={year.id}
            yearLabel={year.label}
            current={isCurrent(year.status)}
            yearSelect={<YearSelect years={years} year={year} onChange={selection.select} />}
          />
        )}
      </TimetableYearGate>
    </TimetableLayout>
  );
}

function ClassPicker({
  yearId,
  yearLabel,
  current,
  yearSelect,
}: {
  yearId: string;
  yearLabel: string;
  current: boolean;
  yearSelect: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const sections = useResource(`tt-sections:${yearId}`, (signal) =>
    timetableApi.sections(yearId, signal),
  );
  const list = sections.status === 'ready' ? sections.data.items : [];
  const sectionId =
    list.find((s) => s.sectionId === params.get('section'))?.sectionId ??
    list[0]?.sectionId ??
    null;

  return (
    <>
      <div className={styles.toolbar}>
        {yearSelect}
        {list.length > 0 && sectionId && (
          <SelectField
            label="Class and section"
            value={sectionId}
            onChange={(e) =>
              setParams(
                (p) => {
                  const next = new URLSearchParams(p);
                  next.set('section', e.target.value);
                  return next;
                },
                { replace: true },
              )
            }
            options={list.map((s) => ({
              value: s.sectionId,
              label: `${s.className} ${s.sectionName}`,
            }))}
          />
        )}
      </div>
      {sections.status === 'loading' && <LoadingState />}
      {sections.status === 'error' && (
        <ErrorState message={sections.error} onRetry={sections.reload} />
      )}
      {sections.status === 'ready' && !sectionId && (
        <Panel>
          <EmptyState icon={Layers} title="No classes to show">
            There are no class timetables for you in {yearLabel}. Teachers see the classes they
            teach in the published timetable; class teachers also see their own class.
          </EmptyState>
        </Panel>
      )}
      {sectionId && (
        <ClassWeek
          key={sectionId}
          yearId={yearId}
          yearLabel={yearLabel}
          sectionId={sectionId}
          current={current}
        />
      )}
    </>
  );
}

function ClassWeek({
  yearId,
  yearLabel,
  sectionId,
  current,
}: {
  yearId: string;
  yearLabel: string;
  sectionId: string;
  current: boolean;
}) {
  const view = useResource(`tt-class:${yearId}:${sectionId}`, (signal) =>
    timetableApi.classTimetable(yearId, sectionId, signal),
  );
  if (view.status === 'loading') return <LoadingState />;
  if (view.status === 'error') return <ErrorState message={view.error} onRetry={view.reload} />;
  const t = view.data;
  const label = `${t.section.className} ${t.section.sectionName}`;
  const notice = frameNotice(t.periods, t.workingDays, yearLabel);
  return (
    <Panel title={label}>
      {!t.published ? (
        <EmptyState icon={CalendarDays} title="Not published yet">
          The {yearLabel} timetable has not been published yet.
        </EmptyState>
      ) : (
        (notice ?? (
          <div className={styles.stack}>
            <PublishedLine version={t.published} />
            <WeekGrid
              periods={t.periods}
              workingDays={t.workingDays}
              entries={t.entries}
              show="teacher"
              caption={`Timetable of ${label}, ${yearLabel}`}
              today={current ? todayWeekday() : null}
            />
          </div>
        ))
      )}
    </Panel>
  );
}
