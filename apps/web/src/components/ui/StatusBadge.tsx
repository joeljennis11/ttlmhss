import type { ReactNode } from 'react';
import styles from './ui.module.css';

export type BadgeTone = 'active' | 'inactive' | 'current' | 'info' | 'warning';

/** Small status label. Meaning is carried by the text; colour only reinforces it. */
export function Badge({ tone = 'info', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[`badge-${tone}`]}`}>{children}</span>;
}

const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  ACTIVE: { tone: 'active', label: 'Active' },
  INACTIVE: { tone: 'inactive', label: 'Inactive' },
  CURRENT: { tone: 'current', label: 'Current' },
  UPCOMING: { tone: 'info', label: 'Upcoming' },
  CLOSED: { tone: 'inactive', label: 'Closed' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: 'info' as const, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
