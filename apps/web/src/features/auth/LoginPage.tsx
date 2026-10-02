import { useRef, useState, type FormEvent } from 'react';
import { ErrorCode } from '@ttlmhss/shared';
import { useBranding } from '../../brand/BrandingProvider';
import { SchoolLogo } from '../../brand/SchoolLogo';
import { usePageTitle } from '../../app/page-meta';
import { Alert, Button, PasswordField, TextField } from '../../components/ui';
import { ApiClientError } from '../../lib/api-client';
import { SystemNotice } from '../system/SystemNotice';
import { useAuth } from './auth-context';
import styles from './LoginPage.module.css';

type FieldErrors = Partial<Record<'username' | 'password', string>>;

/**
 * Sign-in. Uses the real Phase 2 endpoint through AuthProvider.login; on success the route guard
 * moves the user on (to the shell, or to the mandatory password change).
 */
export function LoginPage() {
  usePageTitle('Sign in');
  const { state, login } = useAuth();
  const { shortName, fullName } = useBranding();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const expired = state.status === 'signedOut' && state.reason === 'expired';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const errors: FieldErrors = {};
    if (!username.trim()) errors.username = 'Enter your username.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    if (errors.username) return usernameRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();

    setSubmitting(true);
    try {
      await login({ username, password });
      // The route guard takes over from here.
    } catch (err) {
      setPassword('');
      if (
        err instanceof ApiClientError &&
        err.code === ErrorCode.VALIDATION_ERROR &&
        err.details.length
      ) {
        const next: FieldErrors = {};
        for (const issue of err.details) {
          if (issue.path === 'body.username') next.username = issue.message;
          if (issue.path === 'body.password') next.password = issue.message;
        }
        setFieldErrors(next);
      } else {
        setFormError(
          err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        );
      }
      passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.identity} aria-label="School">
        <div className={styles.identityInner}>
          <SchoolLogo size={176} decorative className={styles.crest} />
          <div className={styles.names}>
            <p className={styles.fullName}>{fullName}</p>
            <p className={styles.shortName}>{shortName}</p>
          </div>
        </div>
      </section>

      <main className={styles.formSide}>
        <form className={styles.form} onSubmit={onSubmit} noValidate aria-labelledby="signin-title">
          <h1 id="signin-title" className={styles.title}>
            Sign in
          </h1>
          <p className={styles.lede}>Use the account details given to you by the school.</p>

          {expired && (
            <Alert tone="info" title="Your session has ended">
              Sign in again to continue.
            </Alert>
          )}
          <SystemNotice />
          {formError && <Alert tone="error">{formError}</Alert>}

          <TextField
            ref={usernameRef}
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={fieldErrors.username}
            disabled={submitting}
          />
          <PasswordField
            ref={passwordRef}
            label="Password"
            name="password"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            disabled={submitting}
          />

          <Button type="submit" fullWidth loading={submitting} loadingLabel="Signing in…">
            Sign in
          </Button>

          <p className={styles.help}>Forgot your password? Ask the school office to reset it.</p>
        </form>
      </main>
    </div>
  );
}
