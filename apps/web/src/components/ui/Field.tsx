import { useId, useState, type InputHTMLAttributes, type Ref } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import styles from './ui.module.css';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Error shown under the field; also marks the input invalid for assistive tech. */
  error?: string | readonly string[] | null;
  hint?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Merge the caller's aria-describedby with the field's own hint/error ids. */
function describedBy(...ids: (string | undefined)[]): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}

function errorList(error: TextFieldProps['error']): readonly string[] {
  if (!error) return [];
  return typeof error === 'string' ? [error] : error;
}

/** Labelled input with hint and error text wired up via aria-describedby. */
export function TextField({ label, error, hint, className, ref, ...input }: TextFieldProps) {
  const id = useId();
  const errors = errorList(error);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors.length ? `${id}-error` : undefined;
  return (
    <div className={[styles.field, className ?? ''].join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        className={styles.input}
        aria-invalid={errors.length > 0 || undefined}
        {...input}
        aria-describedby={describedBy(input['aria-describedby'], hintId, errorId)}
      />
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} className={styles.fieldError}>
          {errors.join(' ')}
        </p>
      )}
    </div>
  );
}

/** Password input with a show/hide toggle (a real button: keyboard and screen-reader operable). */
export function PasswordField({ label, error, hint, className, ref, ...input }: TextFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const errors = errorList(error);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors.length ? `${id}-error` : undefined;
  return (
    <div className={[styles.field, className ?? ''].join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.inputWithAction}>
        <input
          id={id}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={styles.input}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={errors.length > 0 || undefined}
          {...input}
          aria-describedby={describedBy(input['aria-describedby'], hintId, errorId)}
        />
        <button
          type="button"
          className={styles.inputAction}
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-controls={id}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} className={styles.fieldError}>
          {errors.join(' ')}
        </p>
      )}
    </div>
  );
}
