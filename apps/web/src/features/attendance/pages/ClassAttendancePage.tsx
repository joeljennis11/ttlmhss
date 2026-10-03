import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AttendanceClassDayView } from '@ttlmhss/shared';
import { CalendarX2, Layers } from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  TextField,
  useToast,
} from '../../../components/ui';
import { formatPercent } from '../../../lib/format';
import { useResource } from '../../../lib/use-resource';
import {
  TimetableYearGate,
  YearSelect,
  useTimetableYear,
  type TimetableYear,
} from '../../timetable/TimetableLayout';
import { attendanceApi, registerHref } from '../api';
import {
  AttendanceLayout,
  CountsLine,
  StatusLegend,
  StatusMark,
  formatLessonDate,
  formatTime,
  percentText,
  shiftDate,
  todayIso,
} from '../attendance-shared';
import { StudentDayDialog } from '../StudentDayDialog';
import admin from '../../admin/admin.module.css';
import styles from '../attendance.module.css';

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Class teacher / administrator: a class's day (all periods) and totals over a date range. */
export function ClassAttendancePage() {
  const selection = useTimetableYear();
  return (
    <AttendanceLayout
      title="Class attendance"
      description="Every period of a class, who is absent or on leave, which periods are not marked, and attendance totals."
    >
      <TimetableYearGate selection={selection}>
        {(year, years) => (
          <ClassPicker
            key={year.id}
            year={year}
            yearSelect={<YearSelect years={years} year={year} onChange={selection.select} />}
          />
        )}
      </TimetableYearGate>
    </AttendanceLayout>
  );
}

function ClassPicker({ year, yearSelect }: { year: TimetableYear; yearSelect: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const classes = useResource(`att-classes:${year.id}`, (signal) =>
    attendanceApi.classes(year.id, signal),
  );
  const list = classes.status === 'ready' ? classes.data.items : [];
  const sectionId =
    list.find((s) => s.sectionId === params.get('section'))?.sectionId ??
    list[0]?.sectionId ??
    null;
  const today = todayIso();
  const fallback =
    today < year.startDate ? year.startDate : today > year.endDate ? year.endDate : today;
  const date = isDate(params.get('date')) ? params.get('date')! : fallback;
  const mode = params.get('view') === 'summary' ? 'summary' : 'day';
  const update = (patch: Record<string, string>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) next.set(k, v);
        return next;
      },
      { replace: true },
    );

  if (classes.status === 'loading') return <LoadingState />;
  if (classes.status === 'error')
    return <ErrorState message={classes.error} onRetry={classes.reload} />;
  return (
    <>
      <div className={styles.toolbar}>
        {yearSelect}
        {sectionId && (
          <SelectField
            label="Class and section"
            value={sectionId}
            onChange={(e) => update({ section: e.target.value })}
            options={list.map((s) => ({
              value: s.sectionId,
              label: `${s.className} ${s.sectionName}`,
            }))}
          />
        )}
      </div>
      {!sectionId ? (
        <Panel>
          <EmptyState icon={Layers} title="No class to show">
            Class attendance is for class teachers (their own class) and administrators.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div role="tablist" aria-label="View" className={admin.tabs}>
            {(['day', 'summary'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={admin.tab}
                onClick={() => update({ view: m })}
              >
                {m === 'day' ? 'Day' : 'Totals'}
              </button>
            ))}
          </div>
          {mode === 'day' ? (
            <ClassDay
              key={`${sectionId}:${date}`}
              sectionId={sectionId}
              date={date}
              today={today}
              onDate={(d) => update({ date: d })}
            />
          ) : (
            <ClassTotals key={sectionId} sectionId={sectionId} year={year} today={today} />
          )}
        </>
      )}
    </>
  );
}

function ClassDay({
  sectionId,
  date,
  today,
  onDate,
}: {
  sectionId: string;
  date: string;
  today: string;
  onDate: (d: string) => void;
}) {
  const toast = useToast();
  const day = useResource(`att-class-day:${sectionId}:${date}`, (signal) =>
    attendanceApi.classDay(sectionId, date, signal),
  );
  const [student, setStudent] = useState<string | null>(null);

  return (
    <>
      <div className={styles.toolbar}>
        <TextField
          label="Date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && onDate(e.target.value)}
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.linkButton} ${styles.linkSecondary}`}
            onClick={() => onDate(shiftDate(date, -1))}
          >
            Previous day
          </button>
          {date !== today && (
            <button
              type="button"
              className={`${styles.linkButton} ${styles.linkSecondary}`}
              onClick={() => onDate(today)}
            >
              Today
            </button>
          )}
        </div>
      </div>
      {day.status === 'loading' && <LoadingState />}
      {day.status === 'error' && <ErrorState message={day.error} onRetry={day.reload} />}
      {day.status === 'ready' && <DayBody view={day.data} onStudent={setStudent} />}
      {student && (
        <StudentDayDialog
          studentId={student}
          date={date}
          onClose={() => setStudent(null)}
          onSaved={(v) => {
            setStudent(null);
            day.reload();
            toast.show(`Attendance updated for ${v.student.fullName}`);
          }}
        />
      )}
    </>
  );
}

function DayBody({
  view,
  onStudent,
}: {
  view: AttendanceClassDayView;
  onStudent: (id: string) => void;
}) {
  const label = `${view.section.className} ${view.section.sectionName}`;
  if (!view.schoolDay) {
    return (
      <Panel>
        <EmptyState icon={CalendarX2} title="Not a school day">
          {formatLessonDate(view.date)} is not a working day.
        </EmptyState>
      </Panel>
    );
  }
  if (view.periods.length === 0) {
    return (
      <Panel>
        <EmptyState icon={CalendarX2} title="No lessons">
          {label} has no lessons on {formatLessonDate(view.date)} in the timetable in force that
          day.
        </EmptyState>
      </Panel>
    );
  }
  const absent = view.students.filter((s) => Object.values(s.statuses).includes('A'));
  const leave = view.students.filter((s) =>
    Object.values(s.statuses).some((x) => x === 'L' || x === 'C'),
  );
  const unmarked = view.periods.filter(
    (p) => !p.attendance.counts || p.attendance.counts.notMarked > 0,
  );
  return (
    <>
      <Panel title={`${label} — ${formatLessonDate(view.date)}`}>
        <div className={styles.stack} style={{ gap: 'var(--space-3)' }}>
          <CountsLine counts={view.counts} />
          <p className={styles.hint}>
            {absent.length} student{absent.length === 1 ? '' : 's'} absent in at least one period ·{' '}
            {leave.length} on leave or excused · {unmarked.length} period
            {unmarked.length === 1 ? '' : 's'} not completely marked
            {view.future ? ' · this day has not happened yet' : ''}
            {view.locked ? ' · locked' : ''}
          </p>
          <StatusLegend />
        </div>
      </Panel>
      <Panel title="Periods">
        <ul className={styles.lessons}>
          {view.periods.map((p) => (
            <li key={p.period.id} className={styles.lesson}>
              <div className={styles.lessonTime}>
                {p.period.label}
                <span>
                  {formatTime(p.period.startTime)} – {formatTime(p.period.endTime)}
                </span>
              </div>
              <div className={styles.lessonWhat}>
                <span className={styles.lessonTitle}>
                  {p.subject.name} · {p.teacher.fullName}
                </span>
                {p.attendance.counts && <CountsLine counts={p.attendance.counts} compact />}
              </div>
              {!view.future && (
                <Link
                  to={registerHref(view.date, p.period.id, view.section.sectionId)}
                  className={`${styles.linkButton} ${p.attendance.taken ? styles.linkSecondary : ''}`}
                >
                  {view.locked ? 'View' : p.attendance.taken ? 'Open register' : 'Take attendance'}
                  <span className="visually-hidden"> for {p.period.label}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title="Students"
        description="Select a student to see their day and apply Leave or Excused to several periods."
      >
        <div
          className={styles.scroll}
          role="region"
          aria-label={`Attendance of ${label}`}
          tabIndex={0}
        >
          <table className={styles.matrix}>
            <caption className="visually-hidden">
              Attendance of {label} on {formatLessonDate(view.date)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Roll</th>
                <th scope="col">Student</th>
                {view.periods.map((p) => (
                  <th key={p.period.id} scope="col">
                    <span className={styles.colHead}>
                      <strong>{p.period.label}</strong>
                      {p.subject.name}
                    </span>
                  </th>
                ))}
                <th scope="col">Day %</th>
              </tr>
            </thead>
            <tbody>
              {view.students.map((s) => (
                <tr key={s.studentId}>
                  <td>{s.rollNumber ?? '—'}</td>
                  <th scope="row">
                    <button
                      type="button"
                      className={styles.studentButton}
                      onClick={() => onStudent(s.studentId)}
                    >
                      {s.fullName}
                    </button>
                  </th>
                  {view.periods.map((p) => (
                    <td key={p.period.id} className={styles.cell}>
                      <StatusMark status={s.statuses[p.period.id] ?? '-'} />
                    </td>
                  ))}
                  <td>{percentText(s.counts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function ClassTotals({
  sectionId,
  year,
  today,
}: {
  sectionId: string;
  year: TimetableYear;
  today: string;
}) {
  const end = today > year.endDate ? year.endDate : today < year.startDate ? year.startDate : today;
  const monthStart = `${end.slice(0, 8)}01`;
  const [from, setFrom] = useState(monthStart < year.startDate ? year.startDate : monthStart);
  const [to, setTo] = useState(end);
  const summary = useResource(`att-summary:${sectionId}:${from}:${to}`, (signal) =>
    attendanceApi.classSummary(sectionId, from, to, signal),
  );
  return (
    <>
      <div className={styles.toolbar}>
        <TextField
          label="From"
          type="date"
          value={from}
          min={year.startDate}
          max={year.endDate}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          min={year.startDate}
          max={year.endDate}
          onChange={(e) => e.target.value && setTo(e.target.value)}
        />
      </div>
      {summary.status === 'loading' && <LoadingState />}
      {summary.status === 'error' && (
        <ErrorState message={summary.error} onRetry={summary.reload} />
      )}
      {summary.status === 'ready' && (
        <Panel
          title={`${summary.data.section.className} ${summary.data.section.sectionName} — totals`}
          description="Periods held up to today. Attendance % = P ÷ (P + A); Leave, Excused and not-marked periods are not counted."
        >
          <div className={styles.stack} style={{ gap: 'var(--space-3)' }}>
            <CountsLine counts={summary.data.counts} />
            <div className={admin.tableWrap}>
              <table className={`${admin.table} ${admin.stacked}`}>
                <caption className="visually-hidden">Attendance totals</caption>
                <thead>
                  <tr>
                    <th scope="col">Roll</th>
                    <th scope="col">Student</th>
                    <th scope="col" className={admin.num}>
                      P
                    </th>
                    <th scope="col" className={admin.num}>
                      A
                    </th>
                    <th scope="col" className={admin.num}>
                      L
                    </th>
                    <th scope="col" className={admin.num}>
                      C
                    </th>
                    <th scope="col" className={admin.num}>
                      Not marked
                    </th>
                    <th scope="col" className={admin.num}>
                      Attendance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.students.map((s) => (
                    <tr key={s.studentId}>
                      <td data-label="Roll">{s.rollNumber ?? '—'}</td>
                      <td className={admin.strong}>{s.fullName}</td>
                      <td data-label="Present" className={admin.num}>
                        {s.counts.P}
                      </td>
                      <td data-label="Absent" className={admin.num}>
                        {s.counts.A}
                      </td>
                      <td data-label="Leave" className={admin.num}>
                        {s.counts.L}
                      </td>
                      <td data-label="Excused" className={admin.num}>
                        {s.counts.C}
                      </td>
                      <td data-label="Not marked" className={admin.num}>
                        {s.counts.notMarked}
                      </td>
                      <td data-label="Attendance" className={admin.num}>
                        {s.counts.percentage === null ? '—' : formatPercent(s.counts.percentage)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
