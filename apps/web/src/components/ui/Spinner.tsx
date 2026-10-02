import styles from './ui.module.css';

/** Decorative spinner. Pair it with visible text or a `label` for screen readers. */
export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span className={styles.spinnerWrap} role={label ? 'status' : undefined}>
      <svg
        className={styles.spinner}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="3"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="visually-hidden">{label}</span>}
    </span>
  );
}
