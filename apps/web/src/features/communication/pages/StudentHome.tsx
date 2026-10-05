import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ATTENDANCE_STATUS_LABELS, type DashboardView } from '@ttlmhss/shared';
import {
  Award,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  Inbox,
  Smile,
  UserRound,
} from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import { Badge } from '../../../components/ui';
import { formatDate, formatLongDate, formatPercent } from '../../../lib/format';
import { formatTime } from '../../attendance/attendance-shared';
import { RatingText } from '../../portal/portal-shared';
import { AnnouncementCard, RequestRow } from '../shared';
import styles from '../communication.module.css';

const PORTAL_LINKS = [
  { to: '/portal/profile', label: 'Profile', icon: UserRound },
  { to: '/portal/timetable', label: 'Timetable', icon: CalendarDays },
  { to: '/attendance/me', label: 'Attendance', icon: ClipboardCheck },
  { to: '/portal/results', label: 'Marks & results', icon: ChartColumn },
  { to: '/portal/behaviour', label: 'Behaviour', icon: Smile },
  { to: '/portal/achievements', label: 'Achievements', icon: Award },
  { to: '/portal/requests', label: 'Requests', icon: Inbox },
];

function Card({
  title,
  link,
  children,
}: {
  title: string;
  link?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <Panel
      title={title}
      actions={
        link && (
          <Link to={link.to} className={styles.link}>
            {link.label}
          </Link>
        )
      }
    >
      {children}
    </Panel>
  );
}

/**
 * The student's home: today first, then attendance, the latest result, behaviour, achievements,
 * announcements and their own requests. Built for a phone; every card opens the portal page that
 * holds the full record. The data is the student's own (the server decides).
 */
export function StudentHome({ view }: { view: DashboardView }) {
  const st = view.student!;
  const today = st.today;
  return (
    <div className={styles.stack}>
      <section className={styles.hero} aria-label="My class">
        <div>
          <p className={styles.heroTitle}>
            {st.section
              ? `${st.section.className} ${st.section.sectionName}`
              : 'Not placed in a class'}
          </p>
          <p className={styles.heroFacts}>
            <span>{formatLongDate(view.date)}</span>
            {st.student.rollNumber && <span>Roll {st.student.rollNumber}</span>}
            <span>Admission {st.student.admissionNumber}</span>
            {view.academicYear && <span>{view.academicYear.label}</span>}
          </p>
        </div>
      </section>

      <div className={styles.studentGrid}>
        <Card title="Today" link={{ to: '/portal/timetable', label: 'My timetable' }}>
          {!today || today.lessons.length === 0 ? (
            <p className={styles.hint}>
              {today && !today.schoolDay ? 'No school today. ' : ''}No lessons scheduled.
            </p>
          ) : (
            <ol className={styles.timeline} aria-label="Today's lessons">
              {today.lessons.map((l) => (
                <li key={l.period.id} className={styles.lesson}>
                  <span className={styles.lessonTime}>
                    {formatTime(l.period.startTime)}
                    <span className={styles.meta}> {l.period.label}</span>
                  </span>
                  <span>
                    <span className={styles.rowTitle}>{l.subject.name}</span>
                    <span className={styles.meta}> · {l.teacherName}</span>
                  </span>
                  {l.status !== '-' && (
                    <Badge
                      tone={l.status === 'A' ? 'warning' : l.status === 'P' ? 'active' : 'info'}
                    >
                      {ATTENDANCE_STATUS_LABELS[l.status]}
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Attendance" link={{ to: '/attendance/me', label: 'My attendance' }}>
          {!st.attendance || st.attendance.counts.percentage === null ? (
            <p className={styles.hint}>No marked lessons in the last four weeks yet.</p>
          ) : (
            <div>
              <span className={styles.big}>{formatPercent(st.attendance.counts.percentage)}</span>
              <p className={styles.hint}>
                {formatDate(st.attendance.from)} – {formatDate(st.attendance.to)} · present{' '}
                {st.attendance.counts.P}, absent {st.attendance.counts.A} (leave and excused lessons
                are not counted)
              </p>
            </div>
          )}
        </Card>

        <Card title="Latest result" link={{ to: '/portal/results', label: 'Marks & results' }}>
          {!st.latestResult ? (
            <p className={styles.hint}>No results have been published for you yet.</p>
          ) : (
            <div>
              <p className={styles.rowTitle}>{st.latestResult.exam.name}</p>
              {st.latestResult.summary ? (
                <p>
                  <span className={styles.big}>
                    {formatPercent(st.latestResult.summary.percentage)}
                  </span>{' '}
                  <Badge tone={st.latestResult.summary.result === 'PASS' ? 'active' : 'warning'}>
                    {st.latestResult.summary.result === 'PASS' ? 'Pass' : 'Not passed'}
                  </Badge>
                </p>
              ) : null}
              <p className={styles.hint}>
                {st.latestResult.availableCount} of {st.latestResult.requiredCount} subjects
                published
                {st.latestResult.complete ? '' : ' — more will appear as teachers submit them'}
              </p>
            </div>
          )}
        </Card>

        <Card title="Behaviour" link={{ to: '/portal/behaviour', label: 'My behaviour' }}>
          {!st.behaviour ? (
            <p className={styles.hint}>No behaviour assessment has been published yet.</p>
          ) : (
            <div>
              <p className={styles.rowTitle}>{st.behaviour.exam.name}</p>
              <ul className={styles.list}>
                {st.behaviour.ratings.map((r) => (
                  <li key={r.categoryId} className={styles.row}>
                    <span>{r.categoryName}</span>
                    <RatingText rating={r.rating} label={r.label} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Achievements" link={{ to: '/portal/achievements', label: 'My achievements' }}>
          {st.achievements.length === 0 ? (
            <p className={styles.hint}>No achievements recorded yet.</p>
          ) : (
            <ul className={styles.list}>
              {st.achievements.map((a) => (
                <li key={a.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <span className={styles.rowTitle}>{a.title}</span>
                    <span className={styles.meta}>
                      {a.category.name} · {formatDate(a.achievedOn)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="My requests" link={{ to: '/portal/requests', label: 'All my requests' }}>
          {!view.requests || view.requests.items.length === 0 ? (
            <p className={styles.hint}>You have no open requests.</p>
          ) : (
            <ul className={styles.list} aria-label="My open requests">
              {view.requests.items.map((r) => (
                <RequestRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Announcements" link={{ to: '/announcements', label: 'All announcements' }}>
        {!view.announcements || view.announcements.items.length === 0 ? (
          <p className={styles.hint}>No announcements right now.</p>
        ) : (
          <ul className={styles.cards} aria-label="Announcements">
            {view.announcements.items.map((a) => (
              <li key={a.id}>
                <AnnouncementCard a={a} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <nav aria-label="My portal">
        <ul className={styles.links}>
          {PORTAL_LINKS.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className={styles.chip}>
                <l.icon size={18} aria-hidden="true" />
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
