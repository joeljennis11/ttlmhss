import type { ReactNode } from 'react';
import type { AchievementView, StudentBehaviour } from '@ttlmhss/shared';
import { Paperclip } from 'lucide-react';
import { usePageTitle } from '../../app/page-meta';
import { PageHeader } from '../../components/layout/Page';
import { Badge } from '../../components/ui';
import { formatDate } from '../../lib/format';
import styles from './portal.module.css';

export function PortalLayout({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  usePageTitle(title);
  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      <div className={styles.stack}>{children}</div>
    </>
  );
}

/** "4 · Good" — the number and the configured meaning (never colour alone). */
export function RatingText({ rating, label }: { rating: number; label: string | null }) {
  return (
    <span className={styles.rating}>
      <span className={styles.ratingValue} aria-label={`${rating} out of 5`}>
        {rating}/5
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}

/** One exam's behaviour assessment (student page and staff student profile). */
export function BehaviourCard({
  a,
  showStatus = false,
}: {
  a: StudentBehaviour;
  showStatus?: boolean;
}) {
  return (
    <article className={styles.card} aria-label={`Behaviour — ${a.exam.name}`}>
      <div>
        <h3 className={styles.cardTitle}>{a.exam.name}</h3>
        <span className={styles.meta}>
          {a.academicYear.label} · {a.section.className} {a.section.sectionName}
          {a.submittedAt ? ` · published ${formatDate(a.submittedAt)}` : ''}
        </span>
        {showStatus && (
          <div>
            <Badge tone={a.status === 'SUBMITTED' ? 'active' : 'info'}>
              {a.status === 'SUBMITTED' ? 'Submitted' : 'Draft (not visible to the student)'}
            </Badge>
          </div>
        )}
      </div>
      <ul className={styles.list} aria-label="Ratings">
        {a.ratings.map((r) => (
          <li key={r.categoryId} className={styles.listItem}>
            <span className={styles.strong}>{r.categoryName}</span>
            <RatingText rating={r.rating} label={r.label} />
          </li>
        ))}
      </ul>
      {a.remark && (
        <p className={styles.remark}>
          <span className={styles.sub}>Remark</span>
          {a.remark}
        </p>
      )}
    </article>
  );
}

export function AchievementCard({ a, actions }: { a: AchievementView; actions?: ReactNode }) {
  return (
    <article className={styles.card} aria-label={a.title}>
      <div className={styles.statusLine}>
        <Badge tone="current">{a.category.name}</Badge>
        {a.status === 'ARCHIVED' && <Badge tone="inactive">Archived</Badge>}
        {a.hasAttachment && (
          <span className={styles.meta}>
            <Paperclip size={14} aria-hidden="true" /> Attachment
          </span>
        )}
      </div>
      <h3 className={styles.cardTitle}>{a.title}</h3>
      <span className={styles.meta}>
        {formatDate(a.achievedOn)} · {a.academicYear.label}
      </span>
      {a.description && <p className={styles.hint}>{a.description}</p>}
      {actions}
    </article>
  );
}
