import type { ComponentType, ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from './Button';
import { Spinner } from './Spinner';
import styles from './ui.module.css';

/** Content is loading. `fullPage` centres it in the viewport (e.g. while checking the session). */
export function LoadingState({
  label = 'Loading…',
  fullPage = false,
}: {
  label?: string;
  fullPage?: boolean;
}) {
  return (
    <div
      className={fullPage ? styles.stateFullPage : styles.state}
      role="status"
      aria-live="polite"
    >
      <Spinner size={24} />
      <p className={styles.stateText}>{label}</p>
    </div>
  );
}

/** Nothing to show yet. Say what will appear and, when possible, what to do. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.state}>
      {Icon && (
        <span className={styles.stateIcon}>
          <Icon size={24} aria-hidden="true" />
        </span>
      )}
      <p className={styles.stateTitle}>{title}</p>
      {children && <div className={styles.stateText}>{children}</div>}
      {action}
    </div>
  );
}

/** Something failed. Explain what and offer a retry when it makes sense. */
export function ErrorState({
  title = 'This could not be loaded',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.state} role="alert">
      <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
        <CircleAlert size={24} aria-hidden="true" />
      </span>
      <p className={styles.stateTitle}>{title}</p>
      {message && <p className={styles.stateText}>{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
