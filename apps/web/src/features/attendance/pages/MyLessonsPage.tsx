import { useSearchParams } from 'react-router';
import { Panel } from '../../../components/layout/Page';
import { Button, ErrorState, LoadingState, TextField } from '../../../components/ui';
import { useResource } from '../../../lib/use-resource';
import { attendanceApi } from '../api';
import { AttendanceLayout, formatLessonDate, shiftDate, todayIso } from '../attendance-shared';
import { LessonList } from '../LessonList';
import styles from '../attendance.module.css';

/** A teacher's lessons on a date (today by default) with Take attendance for each. */
export function MyLessonsPage() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today;
  const setDate = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true });
  const view = useResource(`att-lessons:${date}`, (signal) => attendanceApi.lessons(date, signal));

  return (
    <AttendanceLayout
      title="My lessons"
      description="Your lessons from the published timetable. Attendance is taken for each lesson; the class, subject and period come from the timetable."
    >
      <div className={styles.toolbar}>
        <TextField
          label="Date"
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setDate(shiftDate(date, -1))}>
            Previous day
          </Button>
          {date !== today && (
            <Button variant="secondary" onClick={() => setDate(today)}>
              Today
            </Button>
          )}
        </div>
      </div>
      <Panel title={date === today ? `Today — ${formatLessonDate(date)}` : formatLessonDate(date)}>
        {view.status === 'loading' && <LoadingState />}
        {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
        {view.status === 'ready' && <LessonList view={view.data} />}
      </Panel>
    </AttendanceLayout>
  );
}
