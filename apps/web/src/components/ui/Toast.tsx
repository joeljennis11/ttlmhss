import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import styles from './ui.module.css';

type ToastTone = 'success' | 'info' | 'error';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  show(message: string, tone?: ToastTone): void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ICONS = { success: CircleCheck, info: Info, error: CircleAlert };
const DURATION_MS = 5000;

/**
 * Short, transient confirmations ("Password changed", "Signed out"). Announced politely to screen
 * readers. Not a notification centre — announcements are a separate module (Phase 10).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-2), { id, tone, message }]);
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.toastRegion} aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <div key={toast.id} className={`${styles.toast} ${styles[`toast-${toast.tone}`]}`}>
              <Icon size={18} aria-hidden="true" />
              <p>{toast.message}</p>
              <button
                type="button"
                className={styles.toastClose}
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
