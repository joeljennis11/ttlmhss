import { Link } from 'react-router';
import { GENDER_LABELS, type PortalProfileView, type TimetableEntryView } from '@ttlmhss/shared';
import {
  Award,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  History,
  Smile,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Panel } from '../../../components/layout/Page';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../../components/ui';
import { formatDate } from '../../../lib/format';
import { useResource } from '../../../lib/use-resource';
import { useAuth } from '../../auth/auth-context';
import { placementLabel, placementStatusLabel } from '../../people/people-shared';
import { todayWeekday } from '../../timetable/TimetableLayout';
import { PublishedLine, frameNotice } from '../../timetable/pages/ViewPages';
import { WeekGrid } from '../../timetable/WeekGrid';
import admin from '../../admin/admin.module.css';
import { portalApi } from '../api';
import { AchievementCard, BehaviourCard, PortalLayout } from '../portal-shared';
import styles from '../portal.module.css';

const LINKS: { to: string; title: string; text: string; icon: LucideIcon }[] = [
  {
    to: '/portal/profile',
    title: 'My profile',
    text: 'Your details, class and history.',
    icon: UserRound,
  },
  {
    to: '/portal/timetable',
    title: 'Timetable',
    text: 'Your week, subjects and teachers.',
    icon: CalendarDays,
  },
  {
    to: '/attendance/me',
    title: 'Attendance',
    text: 'Each period and your percentage.',
    icon: ClipboardCheck,
  },
  {
    to: '/portal/results',
    title: 'Marks & results',
    text: 'Finalised marks, totals and rank.',
    icon: ChartColumn,
  },
  {
    to: '/portal/behaviour',
    title: 'Behaviour',
    text: 'Your published behaviour ratings.',
    icon: Smile,
  },
  {
    to: '/portal/achievements',
    title: 'Achievements',
    text: 'What you have achieved.',
    icon: Award,
  },
];

function useProfile() {
  return useResource('portal-profile', (signal) => portalApi.profile(signal));
}

function Facts({ items }: { items: [string, string | null | undefined][] }) {
  return (
    <dl className={styles.facts}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** /portal — a simple overview with links (not a dashboard). */
export function PortalHomePage() {
  const profile = useProfile();
  return (
    <PortalLayout title="My portal" description="Your own school information, read-only.">
      {profile.status === 'loading' && <LoadingState />}
      {profile.status === 'error' && (
        <ErrorState message={profile.error} onRetry={profile.reload} />
      )}
      {profile.status === 'ready' && (
        <Panel>
          <p className={styles.welcome}>Hello, {profile.data.student.fullName}</p>
          <Facts
            items={[
              ['Academic year', profile.data.currentYear?.label],
              ['Class', profile.data.current ? placementLabel(profile.data.current) : 'Not placed'],
              ['Roll no.', profile.data.current?.rollNumber],
              ['Admission no.', profile.data.student.admissionNumber],
            ]}
          />
        </Panel>
      )}
      <nav aria-label="Student portal">
        <ul className={styles.tiles}>
          {LINKS.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className={styles.tile}>
                <span className={styles.tileIcon}>
                  <l.icon size={20} aria-hidden="true" />
                </span>
                <span>
                  <span className={styles.tileTitle}>{l.title}</span>
                  <span className={styles.tileText}>{l.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PortalLayout>
  );
}

/** /portal/profile — read-only. Corrections go through the school office. */
export function MyProfilePage() {
  const profile = useProfile();
  return (
    <PortalLayout
      title="My profile"
      description="Read-only. If something is wrong, please tell your class teacher or the school office."
    >
      {profile.status === 'loading' && <LoadingState />}
      {profile.status === 'error' && (
        <ErrorState message={profile.error} onRetry={profile.reload} />
      )}
      {profile.status === 'ready' && <Profile view={profile.data} />}
    </PortalLayout>
  );
}

function Profile({ view }: { view: PortalProfileView }) {
  const s = view.student;
  const address = [s.address, s.city, s.state, s.pincode].filter(Boolean).join(', ');
  return (
    <>
      <Panel title={s.fullName}>
        <Facts
          items={[
            ['Admission no.', s.admissionNumber],
            ['Admitted on', s.admissionDate ? formatDate(s.admissionDate) : null],
            ['Date of birth', s.dateOfBirth ? formatDate(s.dateOfBirth) : null],
            ['Gender', s.gender ? GENDER_LABELS[s.gender] : null],
            ['Status', s.status === 'ACTIVE' ? 'Active' : 'Inactive'],
            ['Username', view.account.username],
          ]}
        />
      </Panel>
      <Panel title="Class this year">
        {view.current ? (
          <Facts
            items={[
              ['Academic year', view.current.academicYearLabel],
              ['Class', view.current.className],
              ['Section', view.current.sectionName],
              ['Roll no.', view.current.rollNumber],
            ]}
          />
        ) : (
          <p className={styles.hint}>You are not placed in a class in the current academic year.</p>
        )}
      </Panel>
      <div className={styles.twoCol}>
        <Panel title="Parents / guardian">
          <Facts
            items={[
              ['Father', s.fatherName],
              ['Mother', s.motherName],
              [
                'Guardian',
                s.guardianName
                  ? `${s.guardianName}${s.guardianRelation ? ` (${s.guardianRelation})` : ''}`
                  : null,
              ],
              ['Guardian phone', s.guardianPhone],
            ]}
          />
        </Panel>
        <Panel title="Contact">
          <Facts
            items={[
              ['Phone', s.phone],
              ['Email', s.email],
              ['Address', address],
            ]}
          />
        </Panel>
      </div>
      <Panel title="Academic history" description="Every class you have been placed in.">
        {view.history.length === 0 ? (
          <EmptyState icon={History} title="No placements yet" />
        ) : (
          <div className={admin.tableWrap}>
            <table className={`${admin.table} ${admin.stacked}`}>
              <caption className="visually-hidden">Academic history</caption>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Class</th>
                  <th scope="col">Roll no.</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {view.history.map((p) => (
                  <tr key={p.enrolmentId}>
                    <td className={admin.strong}>{p.academicYearLabel}</td>
                    <td data-label="Class">{placementLabel(p)}</td>
                    <td data-label="Roll no.">{p.rollNumber ?? '—'}</td>
                    <td data-label="From">{formatDate(p.startedOn)}</td>
                    <td data-label="To">{p.endedOn ? formatDate(p.endedOn) : '—'}</td>
                    <td data-label="Outcome">{placementStatusLabel(p, view.history)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

/** Subjects of the published week with their teachers and lessons per week (no new data). */
export function subjectsAndTeachers(entries: readonly TimetableEntryView[]) {
  const map = new Map<string, { name: string; teachers: Set<string>; lessons: number }>();
  for (const e of entries) {
    const item = map.get(e.subjectId) ?? { name: e.subjectName, teachers: new Set(), lessons: 0 };
    item.teachers.add(e.teacherName);
    item.lessons += 1;
    map.set(e.subjectId, item);
  }
  return [...map.entries()]
    .map(([id, v]) => ({ id, name: v.name, teachers: [...v.teachers].sort(), lessons: v.lessons }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** /portal/timetable — the published timetable of the student's own section. */
export function StudentTimetablePage() {
  const { user } = useAuth();
  const studentId = user?.studentId ?? null;
  const view = useResource(studentId ? `portal-tt:${studentId}` : null, (signal) =>
    portalApi.timetable(studentId!, signal),
  );
  return (
    <PortalLayout
      title="My timetable"
      description="Your class's published timetable for this year."
    >
      {view.status === 'loading' && <LoadingState />}
      {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
      {view.status === 'ready' &&
        (!view.data.placement || !view.data.timetable ? (
          <Panel>
            <EmptyState icon={CalendarDays} title="No timetable yet">
              You are not placed in a class this year.
            </EmptyState>
          </Panel>
        ) : (
          (() => {
            const t = view.data.timetable;
            const label = `${t.section.className} ${t.section.sectionName}`;
            const notice = frameNotice(t.periods, t.workingDays, t.academicYear.label);
            if (!t.published)
              return (
                <Panel>
                  <EmptyState icon={CalendarDays} title="Not published yet">
                    The timetable of {label} has not been published yet.
                  </EmptyState>
                </Panel>
              );
            const subjects = subjectsAndTeachers(t.entries);
            return (
              <>
                <Panel title={label}>
                  {notice ?? (
                    <div className={styles.stack} style={{ gap: 'var(--space-3)' }}>
                      <PublishedLine version={t.published} />
                      <WeekGrid
                        periods={t.periods}
                        workingDays={t.workingDays}
                        entries={t.entries}
                        show="teacher"
                        caption={`Timetable of ${label}, ${t.academicYear.label}`}
                        today={t.academicYear.status === 'CURRENT' ? todayWeekday() : null}
                      />
                      <p className={styles.hint}>
                        Holidays and special working days in the school calendar apply as usual.
                      </p>
                    </div>
                  )}
                </Panel>
                <Panel title="My subjects and teachers">
                  {subjects.length === 0 ? (
                    <p className={styles.hint}>No lessons are timetabled yet.</p>
                  ) : (
                    <ul className={styles.list} aria-label="Subjects and teachers">
                      {subjects.map((x) => (
                        <li key={x.id} className={styles.listItem}>
                          <span className={styles.strong}>{x.name}</span>
                          <span>
                            {x.teachers.join(', ')}
                            <span className={styles.sub}>
                              {x.lessons} {x.lessons === 1 ? 'lesson' : 'lessons'} a week
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </>
            );
          })()
        ))}
    </PortalLayout>
  );
}

/** /portal/behaviour — submitted behaviour only (drafts never reach the browser). */
export function MyBehaviourPage() {
  const view = useResource('portal-behaviour', (signal) => portalApi.behaviour(null, signal));
  return (
    <PortalLayout
      title="My behaviour"
      description="Behaviour is assessed for each exam by your class teacher, in each category from 1 to 5."
    >
      {view.status === 'loading' && <LoadingState />}
      {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
      {view.status === 'ready' &&
        (view.data.assessments.length === 0 ? (
          <Panel>
            <EmptyState icon={Smile} title="Nothing published yet">
              No behaviour assessment has been published for you yet.
            </EmptyState>
          </Panel>
        ) : (
          <ul className={styles.cards} aria-label="Behaviour assessments">
            {view.data.assessments.map((a) => (
              <li key={`${a.exam.id}:${a.section.sectionId}`}>
                <BehaviourCard a={a} />
              </li>
            ))}
          </ul>
        ))}
    </PortalLayout>
  );
}

/** /portal/achievements — the student's own active achievements. */
export function MyAchievementsPage() {
  const view = useResource('portal-achievements', (signal) => portalApi.achievements(signal));
  return (
    <PortalLayout title="My achievements" description="Achievements recorded by your school.">
      {view.status === 'loading' && <LoadingState />}
      {view.status === 'error' && <ErrorState message={view.error} onRetry={view.reload} />}
      {view.status === 'ready' &&
        (view.data.items.length === 0 ? (
          <Panel>
            <EmptyState icon={Award} title="No achievements yet">
              Your achievements will appear here once they are recorded.
            </EmptyState>
          </Panel>
        ) : (
          <>
            {view.data.items.some((a) => a.hasAttachment) && (
              <Alert tone="info">Attachments are kept by the school office.</Alert>
            )}
            <ul className={styles.cards} aria-label="Achievements">
              {view.data.items.map((a) => (
                <li key={a.id}>
                  <AchievementCard a={a} />
                </li>
              ))}
            </ul>
          </>
        ))}
    </PortalLayout>
  );
}
