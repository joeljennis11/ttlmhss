import { useNavigate } from 'react-router';
import { usePageTitle } from '../../app/page-meta';
import { SchoolLogo } from '../../brand/SchoolLogo';
import { useBranding } from '../../brand/BrandingProvider';
import { Button, useToast } from '../../components/ui';
import { useAuth } from './auth-context';
import { ChangePasswordForm } from './ChangePasswordForm';
import styles from './ForcedPasswordChangePage.module.css';

/**
 * Mandatory on first sign-in (temporary password). Outside the shell on purpose: nothing else is
 * reachable until the password is changed — the API refuses other requests too.
 */
export function ForcedPasswordChangePage() {
  usePageTitle('Choose your password');
  const { user, logout } = useAuth();
  const { shortName } = useBranding();
  const toast = useToast();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className={styles.page}>
      <main className={styles.panel}>
        <div className={styles.brand}>
          <SchoolLogo size={48} decorative />
          <span>{shortName}</span>
        </div>
        <h1 className={styles.title}>Choose your own password</h1>
        <p className={styles.lede}>
          Welcome, {user.displayName}. You signed in with a temporary password. Choose a new one to
          continue.
        </p>
        <ChangePasswordForm
          user={user}
          forced
          onChanged={() => {
            toast.show('Password changed. You are signed in.');
            navigate('/', { replace: true });
          }}
        />
        <Button variant="ghost" fullWidth onClick={() => void logout()}>
          Sign out
        </Button>
      </main>
    </div>
  );
}
