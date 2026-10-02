import { Link } from 'react-router';
import { ShieldX } from 'lucide-react';
import { usePageTitle } from '../app/page-meta';
import { Panel } from '../components/layout/Page';
import { EmptyState } from '../components/ui';
import buttonStyles from '../components/ui/ui.module.css';

/**
 * Shown when a signed-in user opens a page their role does not include. The API independently
 * refuses the data behind such pages, so this is guidance, not protection.
 */
export function ForbiddenPage() {
  usePageTitle('No access');
  return (
    <Panel>
      <EmptyState
        icon={ShieldX}
        title="You don't have access to this page"
        action={
          <Link to="/" className={`${buttonStyles.button} ${buttonStyles['button-secondary']}`}>
            Go to home
          </Link>
        }
      >
        Your account does not include this page. If you need it, ask the school office.
      </EmptyState>
    </Panel>
  );
}
