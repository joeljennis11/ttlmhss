import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import styles from './ui.module.css';

/**
 * A modal form (native <dialog>: focus is trapped, Escape cancels, the page behind is inert).
 * The caller owns the values; this component owns the frame, the buttons and the error banner.
 */
export function FormDialog({
  open,
  title,
  description,
  children,
  submitLabel,
  pendingLabel = 'Saving…',
  pending = false,
  error,
  wide = false,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  /** A message that is not about one field. */
  error?: string | null;
  wide?: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending) onSubmit();
  }

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${wide ? styles.dialogWide : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      {open && (
        <form onSubmit={submit} noValidate className={styles.dialogForm}>
          <h2 id={titleId} className={styles.dialogTitle}>
            {title}
          </h2>
          {description && <div className={styles.dialogBody}>{description}</div>}
          {error && <Alert tone="error">{error}</Alert>}
          <div className={styles.dialogFields}>{children}</div>
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} loadingLabel={pendingLabel}>
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
