import { HealthResponseSchema, SchoolBrandingSchema } from '@ttlmhss/shared';
import { apiRequest } from '../../lib/api-client';
import { useApiQuery } from '../../lib/use-api-query';
import styles from './FoundationStatus.module.css';

/**
 * Phase 1 foundation page. Proves the full path UI → API → service → data layer → database by
 * showing the school identity stored in the database and the live system status.
 * It is intentionally NOT a login page, dashboard or navigation shell (Phase 3).
 */
export function FoundationStatus() {
  const branding = useApiQuery(
    (signal) => apiRequest('/school/branding', { schema: SchoolBrandingSchema, signal }),
    'branding',
  );
  const health = useApiQuery(
    (signal) => apiRequest('/health', { schema: HealthResponseSchema, signal }),
    'health',
  );

  return (
    <main className={styles.page}>
      <header className={styles.identity} aria-live="polite">
        {branding.status === 'success' ? (
          <>
            <p className={styles.shortName}>{branding.data.shortName}</p>
            <h1 className={styles.fullName}>{branding.data.fullName}</h1>
          </>
        ) : branding.status === 'loading' ? (
          <p className={styles.muted}>Loading school details…</p>
        ) : (
          <p role="alert" className={styles.error}>
            {branding.error.message}
          </p>
        )}
      </header>

      <section className={styles.card} aria-labelledby="status-heading">
        <h2 id="status-heading" className={styles.cardTitle}>
          System status
        </h2>
        {health.status === 'loading' && <p className={styles.muted}>Checking…</p>}
        {health.status === 'error' && (
          <p role="alert" className={styles.error}>
            API: unavailable — {health.error.message}
          </p>
        )}
        {health.status === 'success' && (
          <dl className={styles.statusList}>
            <div>
              <dt>API</dt>
              <dd className={styles.ok}>Running</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd className={health.data.database === 'up' ? styles.ok : styles.error}>
                {health.data.database === 'up' ? 'Connected' : 'Unavailable'}
              </dd>
            </div>
          </dl>
        )}
        <p className={styles.note}>
          Project foundation only. School management features are added in later phases.
        </p>
      </section>
    </main>
  );
}
