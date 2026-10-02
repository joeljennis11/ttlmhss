import type { AuthUser, EffectiveRole } from '@ttlmhss/shared';
import { SystemStatus } from '../system/SystemStatus';
import { useAuth } from './auth-context';
import styles from './auth.module.css';

const ROLE_LABELS: Record<EffectiveRole, string> = {
  ADMIN: 'Administrator',
  TEACHER: 'Teacher',
  CLASS_TEACHER: 'Class Teacher',
  STUDENT: 'Student',
};

/**
 * Minimal signed-in page proving authentication works end to end. NOT a dashboard: the
 * application shell, navigation and role dashboards arrive in Phases 3 and 10.
 */
export function SignedInHome({ user }: { user: AuthUser }) {
  const { logout } = useAuth();
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="home-title">
        <h2 id="home-title" className={styles.cardTitle}>
          Signed in
        </h2>
        <dl className={styles.facts}>
          <div>
            <dt>Name</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{user.roles.map((role) => ROLE_LABELS[role]).join(' + ')}</dd>
          </div>
        </dl>
        <p className={styles.note}>School management features are added in later phases.</p>
        <button className={styles.secondary} type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </section>
      <SystemStatus />
    </main>
  );
}
