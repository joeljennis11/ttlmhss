import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';
import styles from './ui.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  /** Shows a spinner, keeps the label, and blocks further clicks. */
  loading?: boolean;
  /** Label shown while loading (e.g. "Signing in…"). */
  loadingLabel?: string;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  icon,
  fullWidth,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[`button-${variant}`],
    size === 'sm' ? styles['button-sm'] : '',
    fullWidth ? styles['button-full'] : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}
