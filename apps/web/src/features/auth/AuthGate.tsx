import { useAuth } from './auth-context';
import { ChangePasswordPage } from './ChangePasswordPage';
import { LoginPage } from './LoginPage';
import { SignedInHome } from './SignedInHome';
import styles from './auth.module.css';

/**
 * Protected-route behaviour for the web app: nothing behind sign-in renders until the API
 * confirms a session, and a temporary password must be changed before anything else.
 * This is a UX layer only — the API refuses the same requests on its own.
 */
export function AuthGate() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <main className={styles.page}>
        <p className={styles.muted} role="status">
          Loading…
        </p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className={styles.page}>
        <p role="alert" className={styles.error}>
          {state.message}
        </p>
      </main>
    );
  }
  if (state.status === 'signedOut') return <LoginPage />;
  if (state.user.mustChangePassword) return <ChangePasswordPage user={state.user} />;
  return <SignedInHome user={state.user} />;
}
