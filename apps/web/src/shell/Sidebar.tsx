import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router';
import { X } from 'lucide-react';
import { useBranding } from '../brand/BrandingProvider';
import { SchoolLogo } from '../brand/SchoolLogo';
import type { NavSection } from '../app/routes';
import type { NavLinkItem } from './navigation';
import styles from './Sidebar.module.css';

const SECTION_TITLES: Record<NavSection, string | null> = {
  main: null,
  admin: 'Administration',
  account: 'Account',
};

/**
 * School-branded navigation. One element serves all breakpoints: a persistent column on desktop,
 * an icon rail on tablets, and — when `open` — a modal drawer (Escape, backdrop and link clicks
 * close it; focus moves in on open and back to the menu button on close).
 */
export function Sidebar({
  sections,
  open,
  onClose,
}: {
  sections: Record<NavSection, NavLinkItem[]>;
  open: boolean;
  onClose: () => void;
}) {
  const { shortName, fullName } = useBranding();
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, onClose]);

  return (
    <aside
      className={styles.sidebar}
      data-open={open || undefined}
      {...(open ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Menu' } : {})}
    >
      <div className={styles.brand}>
        <SchoolLogo size={40} decorative />
        <span className={styles.brandName}>{shortName}</span>
        {open && (
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label="Main" className={styles.nav}>
        {(Object.keys(sections) as NavSection[]).map((section) =>
          sections[section].length === 0 ? null : (
            <div key={section} className={styles.section}>
              {SECTION_TITLES[section] && (
                <p className={styles.sectionTitle} id={`nav-${section}`}>
                  {SECTION_TITLES[section]}
                </p>
              )}
              <ul
                className={styles.list}
                {...(SECTION_TITLES[section] ? { 'aria-labelledby': `nav-${section}` } : {})}
              >
                {sections[section].map(({ to, label, icon: Icon, end }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={end}
                      title={label}
                      onClick={onClose}
                      className={({ isActive }) =>
                        isActive ? `${styles.link} ${styles.active}` : styles.link
                      }
                    >
                      <Icon size={20} aria-hidden="true" className={styles.icon} />
                      <span className={styles.label}>{label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </nav>

      <p className={styles.footer}>{fullName}</p>
    </aside>
  );
}
