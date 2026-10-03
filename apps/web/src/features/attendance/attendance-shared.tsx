import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, useNavigate } from 'react-router';
import {
  ATTENDANCE_STATUS_DESCRIPTIONS,
  type AttendanceCounts,
  type AttendanceStatus,
  type AuthUser,
} from '@ttlmhss/shared';
import { usePageTitle } from '../../app/page-meta';
import { PageHeader } from '../../components/layout/Page';
import { Badge, ConfirmDialog } from '../../components/ui';
import { formatPercent } from '../../lib/format';
import { canAccessRoute } from '../../shell/navigation';
import { useAuth } from '../auth/auth-context';
import admin from '../admin/admin.module.css';
import styles from './attendance.module.css';

// ---- Dates (school time zone) ---------------------------------------------------------------------

/** Today as YYYY-MM-DD in the school's time zone. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function shiftDate(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const longDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});
/** "2026-10-05" → "Monday, 5 October 2026". */
export const formatLessonDate = (iso: string) => longDate.format(new Date(`${iso}T00:00:00Z`));
/** "2026-10-05" → "Mon, 05 Oct". */
export const formatShortDate = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));

/** "10:10" → "10:10 AM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

// ---- Statuses ---------------------------------------------------------------------------------------

export const STATUS_ORDER: readonly AttendanceStatus[] = ['P', 'A', 'L', 'C', '-'];

/** A status shown as its code with the meaning for screen readers; shape + text, not colour alone. */
export function StatusMark({ status }: { status: AttendanceStatus }) {
  return (
    <span className={styles.mark} data-status={status}>
      <span aria-hidden="true">{status}</span>
      <span className="visually-hidden">{ATTENDANCE_STATUS_DESCRIPTIONS[status]}</span>
    </span>
  );
}

export function StatusLegend() {
  return (
    <ul className={styles.legend} aria-label="Status codes">
      {STATUS_ORDER.map((s) => (
        <li key={s}>
          <span className={styles.mark} data-status={s} aria-hidden="true">
            {s}
          </span>
          {ATTENDANCE_STATUS_DESCRIPTIONS[s]}
        </li>
      ))}
    </ul>
  );
}

export const percentText = (counts: AttendanceCounts) =>
  counts.percentage === null ? 'Not measurable yet' : formatPercent(counts.percentage);

/** "24 of 28 marked · 4 not marked · Attendance 85.71%" with an Incomplete badge (BR-ATT). */
export function CountsLine({
  counts,
  compact = false,
}: {
  counts: AttendanceCounts;
  compact?: boolean;
}) {
  const complete = counts.total > 0 && counts.notMarked === 0;
  return (
    <div className={styles.counts}>
      {counts.total === 0 ? (
        <Badge tone="inactive">No students</Badge>
      ) : complete ? (
        <Badge tone="active">Complete</Badge>
      ) : counts.marked === 0 ? (
        <Badge tone="inactive">Not taken</Badge>
      ) : (
        <Badge tone="warning">Incomplete</Badge>
      )}
      <span>
        {counts.marked} of {counts.total} marked
        {counts.notMarked > 0 ? ` · ${counts.notMarked} not marked` : ''}
      </span>
      {!compact && (
        <span className={styles.tally}>
          P {counts.P} · A {counts.A} · L {counts.L} · C {counts.C} · Attendance{' '}
          {percentText(counts)}
        </span>
      )}
    </div>
  );
}

/** Summary tiles: present, absent, leave, excused, not marked, percentage. */
export function SummaryTiles({ counts }: { counts: AttendanceCounts }) {
  const tiles: [string, string | number][] = [
    ['Present', counts.P],
    ['Absent', counts.A],
    ['Leave', counts.L],
    ['Excused (C)', counts.C],
    ['Not marked', counts.notMarked],
    ['Attendance', percentText(counts)],
  ];
  return (
    <dl className={styles.tiles}>
      {tiles.map(([label, value]) => (
        <div key={label} className={styles.tile}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- Unsaved changes ---------------------------------------------------------------------------------

/**
 * Warns before unsaved changes are lost: the browser's own prompt on reload/close, and a
 * confirmation for links inside the app (the app uses a plain router, so links are intercepted).
 */
export function useLeaveGuard(dirty: boolean): ReactNode {
  const navigate = useNavigate();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || a.target === '_blank') return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const next = `${url.pathname}${url.search}`;
      if (next === `${window.location.pathname}${window.location.search}`) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(next);
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
  return (
    <ConfirmDialog
      open={target !== null}
      title="Leave without saving?"
      confirmLabel="Leave page"
      cancelLabel="Stay"
      tone="danger"
      onCancel={() => setTarget(null)}
      onConfirm={() => {
        const to = target;
        setTarget(null);
        if (to) void navigate(to);
      }}
    >
      <p>Your attendance changes are not saved yet. If you leave now they will be lost.</p>
    </ConfirmDialog>
  );
}

// ---- Section layout ----------------------------------------------------------------------------------

/** The attendance pages and who may open them (UX only — the API enforces the same rules). */
export const ATTENDANCE_PAGES = [
  {
    path: 'attendance/lessons',
    label: 'My lessons',
    roles: ['TEACHER'] as const,
    permission: 'attendance.mark' as const,
  },
  { path: 'attendance/class', label: 'Class attendance', permission: 'attendance.manage' as const },
  { path: 'attendance/registers', label: 'All registers', roles: ['ADMIN'] as const },
  { path: 'attendance/me', label: 'My attendance', roles: ['STUDENT'] as const },
] as const;

function pagesFor(user: Pick<AuthUser, 'permissions' | 'roles'>) {
  return ATTENDANCE_PAGES.filter((p) => canAccessRoute(user, p));
}

/** /attendance opens the first attendance page this user can use. */
export function AttendanceHome() {
  const { user } = useAuth();
  const first = user ? pagesFor(user)[0] : undefined;
  return first ? <Navigate to={`/${first.path}`} replace /> : null;
}

export function AttendanceLayout({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
}) {
  usePageTitle(title);
  const { user } = useAuth();
  const pages = user ? pagesFor(user) : [];
  return (
    <>
      {pages.length > 1 && (
        <nav aria-label="Attendance" className={admin.subnav}>
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
      <PageHeader title={title} description={description} eyebrow={eyebrow} />
      <div className={styles.stack}>{children}</div>
    </>
  );
}
