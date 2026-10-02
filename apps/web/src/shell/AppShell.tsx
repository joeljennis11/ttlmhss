import { useCallback, useState } from 'react';
import { Outlet } from 'react-router';
import type { ShellRoute } from '../app/routes';
import { PageMetaProvider } from '../app/page-meta';
import { useAuth } from '../features/auth/auth-context';
import { useMediaQuery } from '../lib/use-media-query';
import { Header } from './Header';
import { navigationFor } from './navigation';
import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';

export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Authenticated layout used by every page:
 *   desktop ≥1024px  persistent sidebar + header + content
 *   tablet 768–1023  icon rail; the menu button opens the full sidebar over the content
 *   mobile <768px    no sidebar; the menu button opens it as a drawer
 */
export function AppShell({ routes }: { routes: readonly ShellRoute[] }) {
  const { user } = useAuth();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const openNav = useCallback(() => setNavOpen(true), []);
  if (!user) return null;

  const drawerOpen = navOpen && !isDesktop;
  const sections = navigationFor(user, routes);

  return (
    <PageMetaProvider>
      <div className={styles.shell}>
        <a href="#main" className={styles.skipLink}>
          Skip to content
        </a>
        <Sidebar sections={sections} open={drawerOpen} onClose={closeNav} />
        {drawerOpen && <div className={styles.backdrop} onClick={closeNav} aria-hidden="true" />}
        <div className={styles.column} inert={drawerOpen || undefined}>
          <Header menuOpen={drawerOpen} onOpenMenu={openNav} />
          <main id="main" tabIndex={-1} className={styles.content}>
            <Outlet />
          </main>
        </div>
      </div>
    </PageMetaProvider>
  );
}
