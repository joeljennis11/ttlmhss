import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  MARK_TASK_STATE_LABELS,
  type AdminDashboard,
  type ClassDashboard,
  type DashboardView,
  type MarkTaskState,
  type Permission,
  type TeachingDashboard,
} from '@ttlmhss/shared';
import {
  Award,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ClipboardCheck,
  GraduationCap,
  Inbox,
  Megaphone,
  NotebookPen,
  Smile,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { WEEKDAY_LABELS } from '../../../lib/format';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader, Panel } from '../../../components/layout/Page';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  type BadgeTone,
} from '../../../components/ui';
import { formatLongDate } from '../../../lib/format';
import { describeRoles } from '../../../lib/roles';
import { useResource } from '../../../lib/use-resource';
import { LessonList } from '../../attendance/LessonList';
import { CountsLine, percentText } from '../../attendance/attendance-shared';
import { useAuth } from '../../auth/auth-context';
import { dashboardApi } from '../api';
import { AnnouncementCard, RequestRow } from '../shared';
import { StudentHome } from './StudentHome';
import styles from '../communication.module.css';

/**
 * Home (Phase 10): the signed-in user's dashboard — "what do I need to do today?". Everything comes
 * from ONE aggregated API call that is built from the existing services (attendance, timetable +
 * academic calendar, marks, results, behaviour, achievements, announcements, requests). Cards link
 * to the existing pages; nothing is calculated here.
 */
export function DashboardPage() {
  usePageTitle('Home');
  const { user } = useAuth();
  const view = useResource('dashboard', (signal) => dashboardApi.get(signal));
  if (!user) return null;
  return (
    <>
      <PageHeader
        title={`Welcome, ${user.displayName}`}
        description={`You are signed in as ${describeRoles(user)}.`}
      />
      {view.status === 'loading' && <LoadingState />}
      {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
      {view.status === 'ready' &&
        (view.data.student ? (
          <StudentHome view={view.data} />
        ) : (
          <StaffHome view={view.data} permissions={user.permissions} />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

function StaffHome({
  view,
  permissions,
}: {
  view: DashboardView;
  permissions: readonly Permission[];
}) {
  const can = (p: Permission) => permissions.includes(p);
  return (
    <div className={styles.stack}>
      <p className={styles.hint}>
        {formatLongDate(view.date)}
        {view.academicYear ? ` · Academic year ${view.academicYear.label}` : ''}
      </p>
      {view.admin && (
        <AdminBlock
          admin={view.admin}
          date={view.date}
          requests={view.requests?.active ?? null}
          can={can}
        />
      )}
      {view.teaching && <TeachingBlock teaching={view.teaching} date={view.date} />}
      {view.classes.map((c) => (
        <ClassBlock key={c.section.sectionId} c={c} date={view.date} can={can} />
      ))}
      <div className={styles.columns}>
        {view.announcements && (
          <AnnouncementsPanel
            view={view}
            manage={can('announcements.manage') && !!(view.admin || view.classes.length)}
          />
        )}
        {view.requests && (view.admin || view.classes.length > 0) && (
          <Panel
            title="Open requests"
            description="Student requests waiting for review in your scope."
            actions={
              <Link to="/requests" className={styles.link}>
                All requests
              </Link>
            }
          >
            {view.requests.items.length === 0 ? (
              <p className={styles.hint}>No open requests.</p>
            ) : (
              <ul className={styles.list} aria-label="Open requests">
                {view.requests.items.map((r) => (
                  <RequestRow key={r.id} r={r} showStudent />
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label, to }: { value: ReactNode; label: string; to?: string }) {
  const content = (
    <>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className={styles.stat}>
          {content}
        </Link>
      ) : (
        <div className={styles.stat}>{content}</div>
      )}
    </li>
  );
}

function QuickActions({
  label,
  items,
}: {
  label: string;
  items: { to: string; label: string; icon: LucideIcon; show: boolean }[];
}) {
  const shown = items.filter((i) => i.show);
  if (shown.length === 0) return null;
  return (
    <nav aria-label={label}>
      <ul className={styles.tiles}>
        {shown.map((i) => (
          <li key={i.to + i.label}>
            <Link to={i.to} className={styles.tile}>
              <i.icon size={20} aria-hidden="true" />
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const STAGE_TONE: Record<string, BadgeTone> = { DRAFT: 'info', OPEN: 'active', CLOSED: 'inactive' };
const STAGE_LABEL: Record<string, string> = {
  DRAFT: 'Being set up',
  OPEN: 'Open for marks',
  CLOSED: 'Closed',
};

function AdminBlock({
  admin,
  date,
  requests,
  can,
}: {
  admin: AdminDashboard;
  date: string;
  requests: number | null;
  can: (p: Permission) => boolean;
}) {
  const a = admin.today.attendance;
  return (
    <>
      <ul className={styles.stats} aria-label="School at a glance">
        <Stat value={admin.counts.activeStudents} label="Active students" to="/students" />
        <Stat value={admin.counts.activeTeachers} label="Active teachers" to="/teachers" />
        <Stat
          value={`${admin.counts.activeClasses} / ${admin.counts.activeSections}`}
          label="Classes / sections"
          to="/admin/classes"
        />
        {requests !== null && <Stat value={requests} label="Open requests" to="/requests" />}
      </ul>
      <QuickActions
        label="Quick actions"
        items={[
          {
            to: '/students/new',
            label: 'Add student',
            icon: UserPlus,
            show: can('students.create'),
          },
          {
            to: '/teachers/new',
            label: 'Add teacher',
            icon: GraduationCap,
            show: can('teachers.create'),
          },
          { to: '/timetable', label: 'Timetable', icon: CalendarDays, show: can('timetable.view') },
          {
            to: '/attendance',
            label: 'Attendance',
            icon: ClipboardCheck,
            show: can('attendance.view'),
          },
          { to: '/admin/exams', label: 'Exams', icon: NotebookPen, show: can('config.manage') },
          { to: '/marks', label: 'Marks', icon: NotebookPen, show: can('marks.view') },
          {
            to: '/admin/academic-calendar',
            label: 'Academic calendar',
            icon: CalendarRange,
            show: can('config.manage'),
          },
          {
            to: '/announcements/manage',
            label: 'Announcements',
            icon: Megaphone,
            show: can('announcements.manage'),
          },
          { to: '/requests', label: 'Requests', icon: Inbox, show: can('requests.view') },
        ]}
      />
      <div className={styles.columns}>
        <Panel
          title="Today"
          description={admin.today.schoolDay ? 'A working day.' : 'Not a working day.'}
          actions={
            <Link to="/attendance/registers" className={styles.link}>
              Attendance registers
            </Link>
          }
        >
          <div className={styles.stack}>
            {admin.today.notes.length > 0 && (
              <ul className={styles.list}>
                {admin.today.notes.map((n) => (
                  <li key={n} className={styles.row}>
                    {n}
                  </li>
                ))}
              </ul>
            )}
            {a.lessons === 0 ? (
              <p className={styles.hint}>No lessons scheduled today.</p>
            ) : (
              <>
                <p>
                  <strong>
                    {a.taken} of {a.lessons}
                  </strong>{' '}
                  registers taken in {a.workingSections} working{' '}
                  {a.workingSections === 1 ? 'section' : 'sections'}.
                </p>
                <CountsLine counts={a.counts} />
                {a.pending.length > 0 && (
                  <>
                    <h3 className={styles.subhead}>Registers still to be taken</h3>
                    <ul className={styles.list} aria-label="Sections with registers to take">
                      {a.pending.map((p) => (
                        <li key={p.section.sectionId} className={styles.row}>
                          <span className={styles.rowTitle}>
                            {p.section.className} {p.section.sectionName}
                          </span>
                          <span className={styles.meta}>
                            {p.taken} of {p.lessons} taken
                          </span>
                          <Link
                            className={styles.link}
                            to={`/attendance/class?date=${date}&section=${p.section.sectionId}`}
                          >
                            Open class day
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </Panel>
        <Panel
          title="Exams and marks"
          description="Mark sheets of current and upcoming exams."
          actions={
            <Link to="/admin/exams" className={styles.link}>
              Exams
            </Link>
          }
        >
          {admin.exams.length === 0 ? (
            <p className={styles.hint}>No current or upcoming exams.</p>
          ) : (
            <ul className={styles.list} aria-label="Exams">
              {admin.exams.map((e) => (
                <li key={e.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <Link to={`/admin/exams/${e.id}`} className={styles.link}>
                      {e.name}
                    </Link>
                    <span className={styles.meta}>
                      {e.sheets.submitted} of {e.sheets.total} mark sheets submitted
                      {e.sheets.draft ? ` · ${e.sheets.draft} in draft` : ''}
                      {e.sheets.notStarted ? ` · ${e.sheets.notStarted} not started` : ''}
                      {e.sheets.unlocked ? ` · ${e.sheets.unlocked} unlocked for correction` : ''}
                    </span>
                  </div>
                  <Badge tone={STAGE_TONE[e.stage] ?? 'info'}>
                    {STAGE_LABEL[e.stage] ?? e.stage}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {can('timetable.publish') && (
          <Panel
            title="Timetable requests"
            description={
              admin.timetableRequests.pending === 0
                ? 'No change requests waiting for review.'
                : `${admin.timetableRequests.pending} change request${admin.timetableRequests.pending === 1 ? '' : 's'} waiting for review.`
            }
            actions={
              <Link to="/timetable/requests" className={styles.link}>
                Review requests
              </Link>
            }
          >
            {admin.timetableRequests.items.length === 0 ? (
              <p className={styles.hint}>Class teachers' requests appear here.</p>
            ) : (
              <ul className={styles.list} aria-label="Timetable requests">
                {admin.timetableRequests.items.map((r) => (
                  <li key={r.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <Link to="/timetable/requests" className={styles.link}>
                        {r.section} · {WEEKDAY_LABELS[r.day].short} {r.period}
                      </Link>
                      <span className={styles.meta}>
                        {r.requestedBy}: {r.reason}
                      </span>
                    </div>
                    <Badge tone="warning">Waiting</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}

const TASK_TONE: Record<MarkTaskState, BadgeTone> = {
  NOT_STARTED: 'inactive',
  DRAFT: 'info',
  READY_TO_SUBMIT: 'current',
  SUBMITTED: 'active',
  NEEDS_CORRECTION: 'warning',
};

function TeachingBlock({ teaching, date }: { teaching: TeachingDashboard; date: string }) {
  const pending = teaching.markTasks.filter((t) => t.state !== 'SUBMITTED');
  const submitted = teaching.markTasks.length - pending.length;
  return (
    <div className={styles.columns}>
      <Panel
        title={`Today's lessons — ${formatLongDate(date)}`}
        actions={
          <Link to="/timetable/my" className={styles.link}>
            My timetable
          </Link>
        }
      >
        <LessonList view={teaching.lessons} />
      </Panel>
      <Panel
        title="Mark entry"
        description={submitted ? `${submitted} of your sheets are submitted.` : undefined}
        actions={
          <Link to="/marks" className={styles.link}>
            Marks
          </Link>
        }
      >
        {pending.length === 0 ? (
          <p className={styles.hint}>No pending mark-entry tasks.</p>
        ) : (
          <ul className={styles.list} aria-label="Pending mark entry">
            {pending.map((t) => (
              <li key={`${t.examSubjectId}|${t.sectionId}`} className={styles.row}>
                <div className={styles.rowMain}>
                  <Link
                    className={styles.link}
                    to={`/marks/sheet?examSubjectId=${t.examSubjectId}&sectionId=${t.sectionId}`}
                  >
                    {t.subjectName} · {t.className} {t.sectionName}
                  </Link>
                  <span className={styles.meta}>
                    {t.exam.name}
                    {t.total !== null ? ` · ${t.entered} of ${t.total} students entered` : ''}
                  </span>
                </div>
                <Badge tone={TASK_TONE[t.state]}>{MARK_TASK_STATE_LABELS[t.state]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ClassBlock({
  c,
  date,
  can,
}: {
  c: ClassDashboard;
  date: string;
  can: (p: Permission) => boolean;
}) {
  const name = `${c.section.className} ${c.section.sectionName}`;
  const s = c.section.sectionId;
  return (
    <Panel
      title={`My class — ${name}`}
      description={`${c.studentCount} ${c.studentCount === 1 ? 'student' : 'students'} in the class this year.`}
    >
      <div className={styles.stack}>
        <QuickActions
          label={`Class ${name} actions`}
          items={[
            {
              to: `/attendance/class?date=${date}&section=${s}`,
              label: 'Class attendance',
              icon: ClipboardCheck,
              show: can('attendance.manage'),
            },
            {
              to: `/timetable/classes?section=${s}`,
              label: 'Timetable',
              icon: CalendarDays,
              show: can('timetable.view'),
            },
            { to: '/marks', label: 'Marks', icon: NotebookPen, show: can('marks.view') },
            {
              to: `/results?section=${s}`,
              label: 'Results',
              icon: ChartColumn,
              show: can('results.view'),
            },
            { to: '/behaviour', label: 'Behaviour', icon: Smile, show: can('behaviour.manage') },
            {
              to: `/achievements?section=${s}`,
              label: 'Achievements',
              icon: Award,
              show: can('achievements.manage'),
            },
            {
              to: '/announcements/manage',
              label: 'Announcements',
              icon: Megaphone,
              show: can('announcements.manage'),
            },
            { to: '/requests', label: 'Requests', icon: Inbox, show: can('requests.view') },
          ]}
        />
        <div className={styles.columns}>
          <section aria-label={`Attendance today — ${name}`}>
            <h3 className={styles.subhead}>Attendance today</h3>
            {!c.attendance ? (
              <p className={styles.hint}>Attendance is not available for your account.</p>
            ) : c.attendance.lessons === 0 ? (
              <p className={styles.hint}>
                {c.attendance.schoolDay
                  ? 'No lessons scheduled.'
                  : 'Not a working day for this class.'}
              </p>
            ) : (
              <div className={styles.stack}>
                <p>
                  <strong>
                    {c.attendance.taken} of {c.attendance.lessons}
                  </strong>{' '}
                  registers taken · {c.attendance.absentStudents} absent in at least one lesson ·
                  Attendance {percentText(c.attendance.counts)}
                </p>
                {c.attendance.notTaken.length > 0 && (
                  <ul className={styles.list} aria-label="Registers not taken">
                    {c.attendance.notTaken.map((l) => (
                      <li key={l.periodId} className={styles.row}>
                        <span className={styles.rowTitle}>
                          {l.periodLabel} · {l.subjectName}
                        </span>
                        <span className={styles.meta}>{l.teacherName} · not taken yet</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
          <section aria-label={`Exams — ${name}`}>
            <h3 className={styles.subhead}>Exams</h3>
            {c.exams.length === 0 ? (
              <p className={styles.hint}>No open or closed exams for this class yet.</p>
            ) : (
              <ul className={styles.list}>
                {c.exams.map((e) => (
                  <li key={e.exam.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{e.exam.name}</span>
                      <span className={styles.meta}>
                        {e.subjectsSubmitted} of {e.subjectsTotal} subjects submitted · behaviour{' '}
                        {e.behaviour === 'SUBMITTED'
                          ? 'submitted'
                          : e.behaviour === 'DRAFT'
                            ? 'in draft'
                            : 'not started'}
                      </span>
                    </div>
                    <Badge tone={STAGE_TONE[e.exam.stage] ?? 'info'}>
                      {STAGE_LABEL[e.exam.stage] ?? e.exam.stage}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label={`Recent achievements — ${name}`}>
            <h3 className={styles.subhead}>Recent achievements</h3>
            {c.achievements.length === 0 ? (
              <p className={styles.hint}>No achievements recorded yet.</p>
            ) : (
              <ul className={styles.list}>
                {c.achievements.map((a) => (
                  <li key={a.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{a.title}</span>
                      <span className={styles.meta}>
                        {a.student.fullName} · {a.category.name}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Panel>
  );
}

function AnnouncementsPanel({ view, manage }: { view: DashboardView; manage: boolean }) {
  const a = view.announcements!;
  return (
    <Panel
      title="Announcements"
      actions={
        <span className={styles.actions}>
          <Link to="/announcements" className={styles.link}>
            All announcements
          </Link>
          {manage && (
            <Link to="/announcements/manage" className={styles.link}>
              Manage
            </Link>
          )}
        </span>
      }
    >
      {a.items.length === 0 ? (
        <EmptyState icon={Megaphone} title="No announcements right now." />
      ) : (
        <ul className={`${styles.cards} ${styles.cardsSingle}`} aria-label="Announcements">
          {a.items.map((x) => (
            <li key={x.id}>
              <AnnouncementCard a={x} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
