import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import { useToast } from '../components/ui';
import { useAuth } from '../features/auth/auth-context';
import { describeRoles, initials, primaryRoleLabel } from '../lib/roles';
import styles from './UserMenu.module.css';

/**
 * Account disclosure: who is signed in, their role, change password, sign out.
 * Escape and clicks outside close it; focus returns to the button.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      toast.show('You have signed out.', 'info');
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account menu: ${user.displayName}, ${primaryRoleLabel(user)}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(user.displayName)}
        </span>
        <span className={styles.who}>
          <span className={styles.name}>{user.displayName}</span>
          <span className={styles.role}>{primaryRoleLabel(user)}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className={styles.chevron} />
      </button>

      {open && (
        <div id={panelId} className={styles.panel}>
          <div className={styles.identity}>
            <p className={styles.panelName}>{user.displayName}</p>
            <p className={styles.meta}>{user.username}</p>
            <p className={styles.roles}>{describeRoles(user)}</p>
          </div>
          <ul className={styles.actions}>
            <li>
              <Link to="/account/password" className={styles.action} onClick={() => setOpen(false)}>
                <KeyRound size={18} aria-hidden="true" />
                Change password
              </Link>
            </li>
            <li>
              <button
                type="button"
                className={styles.action}
                onClick={() => void signOut()}
                disabled={signingOut}
              >
                <LogOut size={18} aria-hidden="true" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
