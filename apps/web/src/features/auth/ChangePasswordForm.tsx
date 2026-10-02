import { useMemo, useRef, useState, type FormEvent } from 'react';
import { passwordPolicyProblems, type AuthUser } from '@ttlmhss/shared';
import { Check, Circle } from 'lucide-react';
import { Alert, Button, PasswordField } from '../../components/ui';
import { ApiClientError } from '../../lib/api-client';
import { useAuth } from './auth-context';
import styles from './ChangePasswordForm.module.css';

type Field = 'currentPassword' | 'newPassword' | 'confirmPassword';

const RULES: { label: string; test: (password: string, username: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'A letter and a number', test: (p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p) },
  {
    label: 'Not your username or a common password',
    // Only judged once the password is long enough to be a real candidate.
    test: (p, u) =>
      p.length >= 8 && !passwordPolicyProblems(p, u).some((m) => /common|username/.test(m)),
  },
];

/**
 * Change-password form used both for the mandatory first-sign-in change and from the account
 * menu. The rules shown come from the shared policy; the API re-checks everything.
 */
export function ChangePasswordForm({
  user,
  forced,
  onChanged,
}: {
  user: AuthUser;
  forced: boolean;
  onChanged: () => void;
}) {
  const { changePassword } = useAuth();
  const [values, setValues] = useState<Record<Field, string>>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string[]>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  /** Focus the first field (in form order) that has an error. */
  function focusFirst(fieldErrors: Partial<Record<Field, string[]>>) {
    const order: [Field, React.RefObject<HTMLInputElement | null>][] = [
      ['currentPassword', currentRef],
      ['newPassword', newRef],
      ['confirmPassword', confirmRef],
    ];
    const first = order.find(([field]) => fieldErrors[field]);
    first?.[1].current?.focus();
    return Boolean(first);
  }

  const ruleState = useMemo(
    () =>
      RULES.map((rule) => ({
        label: rule.label,
        met: rule.test(values.newPassword, user.username),
      })),
    [values.newPassword, user.username],
  );

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const local: Partial<Record<Field, string[]>> = {};
    if (!values.currentPassword) {
      local.currentPassword = [
        forced ? 'Enter the temporary password.' : 'Enter your current password.',
      ];
    }
    const policy = passwordPolicyProblems(values.newPassword, user.username);
    if (!values.newPassword) local.newPassword = ['Choose a new password.'];
    else if (policy.length) local.newPassword = policy;
    if (values.newPassword && values.confirmPassword !== values.newPassword) {
      local.confirmPassword = ['The passwords do not match.'];
    }
    setErrors(local);
    if (focusFirst(local)) return;

    setSubmitting(true);
    try {
      await changePassword(values);
      onChanged();
    } catch (err) {
      if (err instanceof ApiClientError && err.details.length > 0) {
        const byField: Partial<Record<Field, string[]>> = {};
        for (const issue of err.details) {
          const field = issue.path.replace(/^body\./, '') as Field;
          (byField[field] ??= []).push(issue.message);
        }
        setErrors(byField);
        focusFirst(byField);
      } else {
        setFormError(
          err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {formError && <Alert tone="error">{formError}</Alert>}
      <PasswordField
        ref={currentRef}
        label={forced ? 'Temporary password' : 'Current password'}
        autoComplete="current-password"
        maxLength={128}
        value={values.currentPassword}
        onChange={set('currentPassword')}
        error={errors.currentPassword}
        disabled={submitting}
      />
      <div className={styles.group}>
        <PasswordField
          ref={newRef}
          label="New password"
          autoComplete="new-password"
          maxLength={128}
          value={values.newPassword}
          onChange={set('newPassword')}
          error={errors.newPassword}
          disabled={submitting}
          aria-describedby="password-rules"
        />
        <ul id="password-rules" className={styles.rules} aria-label="Password requirements">
          {ruleState.map((rule) => (
            <li key={rule.label} className={rule.met ? styles.met : undefined}>
              {rule.met ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Circle size={14} aria-hidden="true" />
              )}
              <span>
                {rule.label}
                <span className="visually-hidden">{rule.met ? ' (met)' : ' (not yet met)'}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <PasswordField
        ref={confirmRef}
        label="Confirm new password"
        autoComplete="new-password"
        maxLength={128}
        value={values.confirmPassword}
        onChange={set('confirmPassword')}
        error={errors.confirmPassword}
        disabled={submitting}
      />
      <Button type="submit" loading={submitting} loadingLabel="Saving…" fullWidth={forced}>
        {forced ? 'Save password and continue' : 'Change password'}
      </Button>
    </form>
  );
}
