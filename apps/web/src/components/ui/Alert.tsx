import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import styles from './ui.module.css';

export type Tone = 'info' | 'success' | 'warning' | 'error';

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

/**
 * Inline message. Errors use role="alert" (announced immediately); other tones use role="status".
 * Tone is conveyed by icon + text, not colour alone.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  id,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  id?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div
      id={id}
      className={`${styles.alert} ${styles[`alert-${tone}`]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon size={18} aria-hidden="true" className={styles.alertIcon} />
      <div>
        {title && <p className={styles.alertTitle}>{title}</p>}
        {children && <div className={styles.alertBody}>{children}</div>}
      </div>
    </div>
  );
}
