import { Link } from 'react-router';
import { ChevronRight, Menu } from 'lucide-react';
import { usePageMeta } from '../app/page-meta';
import { useBranding } from '../brand/BrandingProvider';
import { SchoolLogo } from '../brand/SchoolLogo';
import { UserMenu } from './UserMenu';
import styles from './Header.module.css';

export function Header({ menuOpen, onOpenMenu }: { menuOpen: boolean; onOpenMenu: () => void }) {
  const { title } = usePageMeta();
  const { shortName } = useBranding();
  const isHome = title === 'Home';

  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.menuButton}
        onClick={onOpenMenu}
        aria-label="Open menu"
        aria-expanded={menuOpen}
      >
        <Menu size={22} aria-hidden="true" />
      </button>

      {/* On phones the sidebar is hidden, so the header carries the school identity. */}
      <Link to="/" className={styles.mobileBrand} aria-label={`${shortName} home`}>
        <SchoolLogo size={32} decorative />
        <span>{shortName}</span>
      </Link>

      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <ol>
          <li>{isHome ? <span aria-current="page">Home</span> : <Link to="/">Home</Link>}</li>
          {!isHome && title && (
            <li>
              <ChevronRight size={16} aria-hidden="true" className={styles.separator} />
              <span aria-current="page">{title}</span>
            </li>
          )}
        </ol>
      </nav>

      <div className={styles.end}>
        <UserMenu />
      </div>
    </header>
  );
}
