import { useState, type FormEvent } from 'react';
import { SchoolBrandingSchema } from '@ttlmhss/shared';
import { ApiClientError, apiRequest } from '../../lib/api-client';
import { useApiQuery } from '../../lib/use-api-query';
import { SystemStatus } from '../system/SystemStatus';
import { useAuth } from './auth-context';
import styles from './auth.module.css';

/** Functional sign-in screen. Final branded design (logo, layout) is Phase 3. */
export function LoginPage() {
  const { login } = useAuth();
  const branding = useApiQuery(
    (signal) => apiRequest('/school/branding', { schema: SchoolBrandingSchema, signal }),
    'branding',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login({ username, password });
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
      );
      setPassword('');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.identity}>
        {branding.status === 'success' && (
          <>
            <p className={styles.shortName}>{branding.data.shortName}</p>
            <h1 className={styles.fullName}>{branding.data.fullName}</h1>
          </>
        )}
      </header>

      <form className={styles.card} onSubmit={onSubmit} noValidate aria-labelledby="signin-title">
        <h2 id="signin-title" className={styles.cardTitle}>
          Sign in
        </h2>
        <label className={styles.field}>
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            maxLength={64}
          />
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={128}
          />
        </label>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <button
          className={styles.primary}
          type="submit"
          disabled={pending || !username || !password}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className={styles.note}>
          Accounts are created by the school. Forgot your password? Ask the school office.
        </p>
      </form>

      <SystemStatus />
    </main>
  );
}
