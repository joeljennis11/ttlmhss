import { useEffect, type RefObject } from 'react';

/**
 * Opens/closes a native <dialog> with `open`, and returns keyboard focus to the element that
 * opened it when it closes (Phase 12B accessibility fix: focus otherwise fell back to the page).
 */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal?.();
    return () => {
      if (dialog.open) dialog.close?.();
      if (opener?.isConnected) opener.focus();
    };
  }, [ref, open]);
}
