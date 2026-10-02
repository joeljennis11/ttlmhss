import type { AuthUser, EffectiveRole, Permission } from '@ttlmhss/shared';
import type { NavSection, ShellRoute } from '../app/routes';

/** Can this user open the page? (UX gate — the API enforces the same rules.) */
export function canAccessRoute(
  user: Pick<AuthUser, 'permissions' | 'roles'>,
  route: { permission?: Permission; roles?: readonly EffectiveRole[] },
): boolean {
  if (route.permission && !user.permissions.includes(route.permission)) return false;
  if (route.roles && !route.roles.some((role) => user.roles.includes(role))) return false;
  return true;
}

export interface NavLinkItem {
  to: string;
  label: string;
  icon: NonNullable<ShellRoute['nav']>['icon'];
  section: NavSection;
}

/** Navigation for this user: only existing pages, only those they may open, in config order. */
export function navigationFor(
  user: Pick<AuthUser, 'permissions' | 'roles'>,
  routes: readonly ShellRoute[],
): Record<NavSection, NavLinkItem[]> {
  const sections: Record<NavSection, NavLinkItem[]> = { main: [], account: [] };
  for (const route of routes) {
    if (!route.nav || !canAccessRoute(user, route)) continue;
    sections[route.nav.section].push({
      to: `/${route.path}`,
      label: route.nav.label,
      icon: route.nav.icon,
      section: route.nav.section,
    });
  }
  return sections;
}
