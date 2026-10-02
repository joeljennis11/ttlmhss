import { useNavigate } from 'react-router';
import { usePageTitle } from '../app/page-meta';
import { PageHeader, Panel } from '../components/layout/Page';
import { useToast } from '../components/ui';
import { useAuth } from '../features/auth/auth-context';
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm';
import styles from './AccountPasswordPage.module.css';

/** Voluntary password change from the account menu (uses the Phase 2 endpoint). */
export function AccountPasswordPage() {
  usePageTitle('Change password');
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <>
      <PageHeader
        title="Change password"
        description="Changing your password signs you out on your other devices."
      />
      <Panel className={styles.panel}>
        <ChangePasswordForm
          user={user}
          forced={false}
          onChanged={() => {
            toast.show('Password changed.');
            navigate('/', { replace: true });
          }}
        />
      </Panel>
    </>
  );
}
