import { Link } from 'react-router';
import { MapPinOff } from 'lucide-react';
import { usePageTitle } from '../app/page-meta';
import { Panel } from '../components/layout/Page';
import { EmptyState } from '../components/ui';
import buttonStyles from '../components/ui/ui.module.css';

export function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <Panel>
      <EmptyState
        icon={MapPinOff}
        title="Page not found"
        action={
          <Link to="/" className={`${buttonStyles.button} ${buttonStyles['button-secondary']}`}>
            Go to home
          </Link>
        }
      >
        This page does not exist. Check the address, or use the menu to find what you need.
      </EmptyState>
    </Panel>
  );
}
