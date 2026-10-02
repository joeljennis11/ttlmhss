import type { ReactNode } from 'react';
import styles from './layout.module.css';

/** Page heading: the h1 of every shell page (serif, forest) with an optional one-line description. */
export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {description && <p className={styles.pageDescription}>{description}</p>}
    </div>
  );
}

/** A bordered white section. Use for grouped content; not a decorative card. */
export function Panel({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={[styles.panel, className ?? ''].join(' ')}>
      {title && <h2 className={styles.panelTitle}>{title}</h2>}
      {children}
    </section>
  );
}
