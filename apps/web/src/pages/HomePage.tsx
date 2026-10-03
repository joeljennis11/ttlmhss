import { Link } from 'react-router';
import { BookOpen, Settings } from 'lucide-react';
import { usePageTitle } from '../app/page-meta';
import { PageHeader, Panel } from '../components/layout/Page';
import { EmptyState } from '../components/ui';
import { useAuth } from '../features/auth/auth-context';
import { describeRoles } from '../lib/roles';
import styles from './HomePage.module.css';

/**
 * Foundation landing page (Phase 3). It shows only real information about the signed-in account.
 * Role dashboards (attendance, timetable, results …) arrive in Phase 10; nothing here is invented.
 */
export function HomePage() {
  usePageTitle('Home');
  const { user } = useAuth();
  if (!user) return null;

  const classCount = user.classTeacherOf.length;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.displayName}`}
        description={`You are signed in as ${describeRoles(user)}.`}
      />
      <div className={styles.layout}>
        <Panel title="Your account">
          <dl className={styles.facts}>
            {user.displayName !== user.username && (
              <div>
                <dt>Name</dt>
                <dd>{user.displayName}</dd>
              </div>
            )}
            <div>
              <dt>Username</dt>
              <dd>{user.username}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{describeRoles(user)}</dd>
            </div>
            {classCount > 0 && (
              <div>
                <dt>Class teacher</dt>
                <dd>
                  {classCount === 1 ? 'Assigned to 1 class' : `Assigned to ${classCount} classes`}
                </dd>
              </div>
            )}
          </dl>
        </Panel>
        {user.permissions.includes('config.manage') ? (
          <Panel className={styles.next}>
            <EmptyState
              icon={Settings}
              title="Set up the school"
              action={
                <Link to="/admin" className={styles.cta}>
                  Open school setup
                </Link>
              }
            >
              Academic years, classes and sections, subjects, the school day, grading, exams,
              behaviour and achievement categories, and role permissions.
            </EmptyState>
          </Panel>
        ) : (
          <Panel className={styles.next}>
            <EmptyState icon={BookOpen} title="Your school tools will appear here">
              TTLMHSS is being built step by step. Pages for your role, such as timetable,
              attendance and results, will be added to the menu as each one is ready.
            </EmptyState>
          </Panel>
        )}
      </div>
    </>
  );
}
