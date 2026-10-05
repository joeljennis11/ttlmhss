import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  PROFILE_FIELD_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_TYPE_LABELS,
  type AnnouncementView,
  type RequestStatus,
  type RequestView,
} from '@ttlmhss/shared';
import { Badge, type BadgeTone } from '../../components/ui';
import { formatDate, formatDateTime } from '../../lib/format';
import styles from './communication.module.css';

const PREVIEW_LENGTH = 180;

export const preview = (text: string) =>
  text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH).trimEnd()}…` : text;

/** Draft / Archived / Expired — text, never colour alone. */
export function AnnouncementBadges({ a }: { a: AnnouncementView }) {
  return (
    <>
      {a.status === 'DRAFT' && <Badge tone="info">Draft</Badge>}
      {a.status === 'ARCHIVED' && <Badge tone="inactive">Archived</Badge>}
      {a.status === 'PUBLISHED' && a.expired && <Badge tone="warning">Expired</Badge>}
      {a.status === 'PUBLISHED' && !a.expired && <Badge tone="active">Published</Badge>}
    </>
  );
}

/** An announcement card: title (opens the full announcement), date, audience, author, preview. */
export function AnnouncementCard({
  a,
  showStatus = false,
  actions,
}: {
  a: AnnouncementView;
  showStatus?: boolean;
  actions?: ReactNode;
}) {
  const muted = a.status !== 'PUBLISHED' || a.expired;
  return (
    <article className={`${styles.card} ${muted ? styles.cardMuted : ''}`}>
      <h3 className={styles.cardTitle}>
        <Link to={`/announcements/${a.id}`} className={styles.cardLink}>
          {a.title}
        </Link>
      </h3>
      <span className={styles.meta}>
        {a.publishedAt ? formatDateTime(a.publishedAt) : `Created ${formatDateTime(a.createdAt)}`}
        {' · '}
        {a.audienceLabel}
        {a.author ? ` · ${a.author}` : ''}
      </span>
      {showStatus && (
        <div className={styles.badges}>
          <AnnouncementBadges a={a} />
          {a.expiresOn && <span className={styles.meta}>Until {formatDate(a.expiresOn)}</span>}
        </div>
      )}
      <p className={styles.preview}>{preview(a.body)}</p>
      {actions}
    </article>
  );
}

const STATUS_TONE: Record<RequestStatus, BadgeTone> = {
  OPEN: 'info',
  IN_REVIEW: 'warning',
  RESOLVED: 'active',
  CLOSED: 'inactive',
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{REQUEST_STATUS_LABELS[status]}</Badge>;
}

/** What the request refers to, in words. */
export function relatedText(r: RequestView): string {
  if (r.type === 'ATTENDANCE_ISSUE') {
    return [
      r.related.date ? formatDate(r.related.date) : null,
      r.related.period?.label,
      r.related.subject?.name,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (r.type === 'RESULT_CLARIFICATION') {
    return [r.related.exam?.name, r.related.subject?.name].filter(Boolean).join(' · ');
  }
  return r.related.field ? PROFILE_FIELD_LABELS[r.related.field] : '';
}

/** One request in a list (students: their own; reviewers: with the student). */
export function RequestRow({ r, showStudent = false }: { r: RequestView; showStudent?: boolean }) {
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <Link to={`/requests/${r.id}`} className={styles.link}>
          {r.summary}
        </Link>
        <span className={styles.meta}>
          {REQUEST_TYPE_LABELS[r.type]} · {r.reference}
          {showStudent
            ? ` · ${r.student.fullName} (${r.section.className} ${r.section.sectionName})`
            : ''}
        </span>
        <span className={styles.meta}>
          Sent {formatDateTime(r.createdAt)} · updated {formatDateTime(r.updatedAt)}
          {showStudent && r.assignedTo ? ` · with ${r.assignedTo.name}` : ''}
        </span>
      </div>
      <RequestStatusBadge status={r.status} />
    </li>
  );
}
