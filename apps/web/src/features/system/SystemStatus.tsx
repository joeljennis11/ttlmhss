import { HealthResponseSchema } from '@ttlmhss/shared';
import { apiRequest } from '../../lib/api-client';
import { useApiQuery } from '../../lib/use-api-query';
import styles from '../auth/auth.module.css';

/** One-line API/database status (the Phase 1 foundation check, kept as a footer). */
export function SystemStatus() {
  const health = useApiQuery(
    (signal) => apiRequest('/health', { schema: HealthResponseSchema, signal }),
    'health',
  );
  const text =
    health.status === 'loading'
      ? 'Checking system…'
      : health.status === 'error'
        ? 'System unavailable'
        : health.data.database === 'up'
          ? 'System online'
          : 'Database unavailable';
  const ok = health.status === 'success' && health.data.database === 'up';
  return (
    <p className={styles.status} role="status">
      <span className={ok ? styles.dotOk : styles.dotBad} aria-hidden="true" />
      {text}
    </p>
  );
}
