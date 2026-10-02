import type { ReactElement } from 'react';
import type { EffectiveRole, Permission } from '@ttlmhss/shared';
import { House, KeyRound, type LucideIcon } from 'lucide-react';
import { HomePage } from '../pages/HomePage';
import { AccountPasswordPage } from '../pages/AccountPasswordPage';

export type NavSection = 'main' | 'account';

/**
 * A page inside the authenticated shell. This list is the single source for BOTH routing and
 * navigation, so the menu can only ever link to pages that exist.
 *
 * Access rules here are UX only: they hide links and show a "no access" page. Every API the page
 * calls enforces the same rules on the server (docs/permissions.md).
 *
 * Adding a module (later phases): add its page here with `permission` (and `roles` if needed) and a
 * `nav` entry. Do not add entries for modules that are not built.
 */
export interface ShellRoute {
  /** Path relative to "/" ("" = home). */
  path: string;
  title: string;
  element: ReactElement;
  /** Required permission (from the shared catalogue). */
  permission?: Permission;
  /** Restrict to users holding at least one of these effective roles. */
  roles?: readonly EffectiveRole[];
  nav?: { label: string; icon: LucideIcon; section: NavSection };
}

export const SHELL_ROUTES: readonly ShellRoute[] = [
  {
    path: '',
    title: 'Home',
    element: <HomePage />,
    nav: { label: 'Home', icon: House, section: 'main' },
  },
  {
    path: 'account/password',
    title: 'Change password',
    element: <AccountPasswordPage />,
    nav: { label: 'Change password', icon: KeyRound, section: 'account' },
  },
];
