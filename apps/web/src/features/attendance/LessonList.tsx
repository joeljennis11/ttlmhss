import { Link } from 'react-router';
import type { AttendanceLessonsView } from '@ttlmhss/shared';
import { CalendarX2, ClipboardCheck } from 'lucide-react';
import { Panel } from '../../components/layout/Page';
import { Badge, EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { useResource } from '../../lib/use-resource';
import { attendanceApi, registerHref } from './api';
import { CountsLine, formatLessonDate, formatTime, todayIso } from './attendance-shared';
import styles from './attendance.module.css';

/**
 * A teacher's lessons on a date, each with its register state and the real "Take attendance"
 * action. Only lessons from the timetable in force (or registers already taken) are listed: no
 * breaks, no free periods, no other teacher's lessons.
 */
export function LessonList({ view }: { view: AttendanceLessonsView }) {
  if (!view.schoolDay) {
    return (
      <EmptyState icon={CalendarX2} title="No lessons on this day">
        {view.academicYear
          ? 'This is not a working day in the school calendar.'
          : 'This date is outside every academic year.'}
      </EmptyState>
    );
  }
  if (view.lessons.length === 0) {
    return (
      <EmptyState icon={CalendarX2} title="No lessons for you">
        You have no lessons on this day in the published timetable.
      </EmptyState>
    );
  }
  return (
    <ul className={styles.lessons}>
      {view.lessons.map((l) => {
        const label = `${l.section.className} ${l.section.sectionName}`;
        const href = registerHref(view.date, l.period.id, l.section.sectionId);
        const action = view.future
          ? null
          : l.attendance.locked
            ? 'View attendance'
            : l.attendance.taken
              ? 'Open attendance'
              : 'Take attendance';
        return (
          <li key={`${l.period.id}|${l.section.sectionId}`} className={styles.lesson}>
            <div className={styles.lessonTime}>
              {l.period.label}
              <span>
                {formatTime(l.period.startTime)} – {formatTime(l.period.endTime)}
              </span>
            </div>
            <div className={styles.lessonWhat}>
              <span className={styles.lessonTitle}>
                {label} · {l.subject.name}
              </span>
              {view.future ? (
                <span className={styles.hint}>Attendance opens on the day of the lesson.</span>
              ) : (
                l.attendance.counts && <CountsLine counts={l.attendance.counts} compact />
              )}
              {l.attendance.locked && <Badge tone="inactive">Locked</Badge>}
            </div>
            {action && (
              <Link
                to={href}
                className={
                  l.attendance.taken || l.attendance.locked
                    ? `${styles.linkButton} ${styles.linkSecondary}`
                    : styles.linkButton
                }
              >
                <ClipboardCheck size={18} aria-hidden="true" />
                {action}
                <span className="visually-hidden">
                  {' '}
                  for {label}, {l.subject.name}, {l.period.label}
                </span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Today's lessons" with Take attendance — shown on a teacher's timetable page. */
export function TodayLessons() {
  const today = todayIso();
  const view = useResource(`att-lessons:${today}`, (signal) =>
    attendanceApi.lessons(today, signal),
  );
  return (
    <Panel title={`Today's lessons — ${formatLessonDate(today)}`}>
      {view.status === 'loading' && <LoadingState />}
      {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
      {view.status === 'ready' && <LessonList view={view.data} />}
    </Panel>
  );
}
