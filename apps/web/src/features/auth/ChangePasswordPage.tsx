import { useState, type FormEvent } from 'react';
import { passwordPolicyProblems, type AuthUser } from '@ttlmhss/shared';
import { ApiClientError } from '../../lib/api-client';
import { useAuth } from './auth-context';
import styles from './auth.module.css';

/**
 * Mandatory on first sign-in with a temporary password (and available for normal changes).
 * Rules shown here come from the shared policy; the API re-checks everything.
 */
export function ChangePasswordPage({ user }: { user: AuthUser }) {
  const { changePassword, logout } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const hints = newPassword ? passwordPolicyProblems(newPassword, user.username) : [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
    } catch (err) {
      if (err instanceof ApiClientError && err.details.length > 0) {
        const byField: Record<string, string[]> = {};
        for (const issue of err.details) {
          const field = issue.path.replace(/^body\./, '');
          (byField[field] ??= []).push(issue.message);
        }
        setErrors(byField);
      } else {
        setFormError(
          err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        );
      }
    } finally {
      setPending(false);
    }
  }

  const fieldErrors = (name: string) =>
    errors[name]?.map((message) => (
      <span key={message} className={styles.fieldError}>
        {message}
      </span>
    ));

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={onSubmit} noValidate aria-labelledby="change-title">
        <h2 id="change-title" className={styles.cardTitle}>
          {user.mustChangePassword ? 'Set your own password' : 'Change password'}
        </h2>
        {user.mustChangePassword && (
          <p className={styles.note}>
            You signed in with a temporary password. Choose a new password to continue.
          </p>
        )}
        <label className={styles.field}>
          <span>{user.mustChangePassword ? 'Temporary password' : 'Current password'}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            maxLength={128}
          />
          {fieldErrors('currentPassword')}
        </label>
        <label className={styles.field}>
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            maxLength={128}
            aria-describedby="password-rules"
          />
          {fieldErrors('newPassword')}
        </label>
        <ul id="password-rules" className={styles.rules}>
          <li>At least 8 characters, with a letter and a number</li>
          {hints.map((hint) => (
            <li key={hint} className={styles.fieldError}>
              {hint}
            </li>
          ))}
        </ul>
        <label className={styles.field}>
          <span>Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirm(e.target.value)}
            maxLength={128}
          />
          {fieldErrors('confirmPassword')}
        </label>
        {formError && (
          <p role="alert" className={styles.error}>
            {formError}
          </p>
        )}
        <button
          className={styles.primary}
          type="submit"
          disabled={pending || !currentPassword || !newPassword || !confirmPassword}
        >
          {pending ? 'Saving…' : 'Save new password'}
        </button>
        <button className={styles.secondary} type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </form>
    </main>
  );
}
