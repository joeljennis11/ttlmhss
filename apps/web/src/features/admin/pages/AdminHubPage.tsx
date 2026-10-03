import { Link } from 'react-router';
import { usePageTitle } from '../../../app/page-meta';
import { PageHeader } from '../../../components/layout/Page';
import { useAuth } from '../../auth/auth-context';
import { canAccessRoute } from '../../../shell/navigation';
import { ADMIN_PAGES, type AdminPageInfo } from '../admin-pages';
import styles from '../admin.module.css';

const GROUPS: AdminPageInfo['group'][] = ['School', 'Teaching rules', 'Access'];

/** Entry point of the Admin configuration area: links to each setup page (no statistics). */
export function AdminHubPage() {
  usePageTitle('School setup');
  const { user } = useAuth();
  if (!user) return null;
  const pages = ADMIN_PAGES.filter((p) => canAccessRoute(user, p));
  return (
    <>
      <PageHeader
        title="School setup"
        description="Configure the school's structure and rules. Other modules use these settings, so set them up before adding students, timetables or exams."
      />
      {GROUPS.map((group) => {
        const items = pages.filter((p) => p.group === group);
        if (!items.length) return null;
        return (
          <section key={group} className={styles.hubGroup} aria-labelledby={`hub-${group}`}>
            <h2 id={`hub-${group}`} className={styles.hubGroupTitle}>
              {group}
            </h2>
            <ul className={styles.hubGrid}>
              {items.map(({ id, path, title, summary, icon: Icon }) => (
                <li key={id}>
                  <Link to={`/${path}`} className={styles.hubCard}>
                    <span className={styles.hubIcon}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span>
                      <span className={styles.hubTitle}>{title}</span>
                      <span className={styles.hubSummary}>{summary}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
