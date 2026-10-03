import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import styles from './ui.module.css';

/** "Showing 26–50 of 132" with previous / next. The server does the paging. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  label = 'records',
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={styles.pagination} aria-label="Pages">
      <p aria-live="polite">
        {total === 0 ? `No ${label}` : `Showing ${from}–${to} of ${total} ${label}`}
      </p>
      {pages > 1 && (
        <div className={styles.paginationButtons}>
          <Button
            variant="secondary"
            size="sm"
            icon={<ChevronLeft size={16} aria-hidden="true" />}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            Next
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}

/** Initials in a circle — used until photo upload exists. */
export function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  );
}
