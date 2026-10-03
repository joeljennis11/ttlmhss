import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { usePageTitle } from '../../app/page-meta';
import { PageHeader } from '../../components/layout/Page';
import { useAuth } from '../auth/auth-context';
import { canAccessRoute } from '../../shell/navigation';
import { ADMIN_PAGES, adminPage, type AdminPageId } from './admin-pages';
import styles from './admin.module.css';

/** In-page navigation between the setup pages (scrolls sideways on small screens). */
export function AdminSubnav() {
  const { user } = useAuth();
  if (!user) return null;
  const pages = ADMIN_PAGES.filter((p) => canAccessRoute(user, p));
  return (
    <nav aria-label="School setup" className={styles.subnav}>
      <ul>
        {pages.map((p) => (
          <li key={p.id}>
            <NavLink
              to={`/${p.path}`}
              className={({ isActive }) =>
                isActive ? `${styles.subLink} ${styles.subActive}` : styles.subLink
              }
              {...(p.short !== p.title ? { title: p.title } : {})}
            >
              {p.short}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Frame for every admin configuration page: title, description, actions and setup navigation. */
export function AdminLayout({
  page,
  title,
  description,
  actions,
  back,
  children,
}: {
  page: AdminPageId;
  /** Overrides the page's own title (e.g. an exam name on the exam detail page). */
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  children: ReactNode;
}) {
  const info = adminPage(page);
  const heading = title ?? info.title;
  usePageTitle(heading);
  return (
    <>
      <AdminSubnav />
      <PageHeader
        title={heading}
        description={description ?? info.summary}
        actions={actions}
        eyebrow={
          back ? (
            <Link to={back.to} className={styles.backLink}>
              ← {back.label}
            </Link>
          ) : (
            <Link to="/admin" className={styles.backLink}>
              School setup
            </Link>
          )
        }
      />
      <div className={styles.stack}>{children}</div>
    </>
  );
}
