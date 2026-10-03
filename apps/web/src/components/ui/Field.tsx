import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
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

/** Shared label / hint / error frame for the other field types. */
function FieldFrame({
  id,
  label,
  hint,
  errors,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  errors: readonly string[];
  className?: string | undefined;
  children: (aria: { describedBy: string | undefined; invalid: true | undefined }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors.length ? `${id}-error` : undefined;
  return (
    <div className={[styles.field, className ?? ''].join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children({
        describedBy: describedBy(hintId, errorId),
        invalid: errors.length > 0 || undefined,
      })}
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

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  error?: string | readonly string[] | null;
  hint?: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  /** Adds a first, empty option with this text (e.g. "Choose…"). */
  placeholder?: string;
}

/** Native select (keyboard, screen-reader and mobile friendly). */
export function SelectField({
  label,
  error,
  hint,
  options,
  placeholder,
  className,
  ...select
}: SelectFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} errors={errorList(error)} className={className}>
      {({ describedBy: ids, invalid }) => (
        <select
          id={id}
          className={`${styles.input} ${styles.select}`}
          aria-invalid={invalid}
          aria-describedby={ids}
          {...select}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: string;
  error?: string | readonly string[] | null;
  hint?: string;
}

export function TextAreaField({ label, error, hint, className, ...area }: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} errors={errorList(error)} className={className}>
      {({ describedBy: ids, invalid }) => (
        <textarea
          id={id}
          rows={3}
          className={`${styles.input} ${styles.textarea}`}
          aria-invalid={invalid}
          aria-describedby={ids}
          {...area}
        />
      )}
    </FieldFrame>
  );
}

export interface CheckboxFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type'
> {
  label: ReactNode;
  hint?: ReactNode;
}

/** A checkbox with its label to the right; the whole row is clickable. */
export function CheckboxField({ label, hint, className, ...input }: CheckboxFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={[styles.checkRow, className ?? ''].join(' ')}>
      <input
        id={id}
        type="checkbox"
        className={styles.checkbox}
        aria-describedby={hintId}
        {...input}
      />
      <div>
        <label htmlFor={id} className={styles.checkLabel}>
          {label}
        </label>
        {hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
