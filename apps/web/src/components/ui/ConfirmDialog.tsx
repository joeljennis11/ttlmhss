import { useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './ui.module.css';
import { useModalDialog } from './use-modal-dialog';

/**
 * Confirmation before consequential actions (built on the native <dialog>: focus is trapped,
 * Escape cancels, the page behind is inert).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useModalDialog(ref, open);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id={titleId} className={styles.dialogTitle}>
        {title}
      </h2>
      {children && <div className={styles.dialogBody}>{children}</div>}
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button variant={tone} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
