import type { ReactNode } from 'react';
import styles from './layout.module.css';

/**
 * Page heading: the h1 of every shell page (serif, forest) with an optional one-line description
 * and optional page actions (e.g. "Add class") aligned to the right on wide screens.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small line above the title (e.g. a back link). */
  eyebrow?: ReactNode;
}) {
  return (
    <div className={`${styles.pageHeader} ${actions ? styles.withActions : ''}`}>
      <div>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <h1 className={styles.pageTitle}>{title}</h1>
        {description && <p className={styles.pageDescription}>{description}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </div>
  );
}

/** A bordered white section. Use for grouped content; not a decorative card. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={[styles.panel, className ?? ''].join(' ')}>
      {(title || actions) && (
        <div className={styles.panelHead}>
          <div>
            {title && <h2 className={styles.panelTitle}>{title}</h2>}
            {description && <p className={styles.panelDescription}>{description}</p>}
          </div>
          {actions && <div className={styles.panelActions}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
