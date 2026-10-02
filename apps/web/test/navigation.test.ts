import { describe, expect, it } from 'vitest';
import { House, Users } from 'lucide-react';
import type { ShellRoute } from '../src/app/routes';
import { describeRoles, initials, primaryRoleLabel } from '../src/lib/roles';
import { canAccessRoute, navigationFor } from '../src/shell/navigation';

const el = null as unknown as ShellRoute['element'];
const routes: ShellRoute[] = [
  { path: '', title: 'Home', element: el, nav: { label: 'Home', icon: House, section: 'main' } },
  {
    path: 'x',
    title: 'X',
    element: el,
    permission: 'users.view',
    nav: { label: 'Users', icon: Users, section: 'main' },
  },
  { path: 'hidden', title: 'Hidden', element: el },
];

describe('navigation model', () => {
  it('lists only pages with a menu entry that the user may open', () => {
    const teacher = { permissions: [], roles: ['TEACHER' as const] };
    expect(navigationFor(teacher, routes).main.map((i) => i.label)).toEqual(['Home']);
    const admin = { permissions: ['users.view' as const], roles: ['ADMIN' as const] };
    expect(navigationFor(admin, routes).main.map((i) => i.to)).toEqual(['/', '/x']);
  });

  it('applies permission and role requirements together', () => {
    const u = { permissions: ['users.view' as const], roles: ['TEACHER' as const] };
    expect(canAccessRoute(u, { permission: 'users.view' })).toBe(true);
    expect(canAccessRoute(u, { permission: 'users.view', roles: ['CLASS_TEACHER'] })).toBe(false);
    expect(canAccessRoute(u, {})).toBe(true);
  });
});

describe('role display helpers', () => {
  it('describes combined roles in plain words', () => {
    expect(describeRoles({ roles: ['TEACHER', 'CLASS_TEACHER'] })).toBe(
      'Teacher and Class Teacher',
    );
    expect(describeRoles({ roles: ['ADMIN'] })).toBe('Administrator');
    expect(primaryRoleLabel({ roles: ['TEACHER', 'CLASS_TEACHER'] })).toBe('Class Teacher');
  });

  it('builds initials from names and usernames', () => {
    expect(initials('Test Class Teacher')).toBe('TT');
    expect(initials('office.admin')).toBe('OA');
    expect(initials('Arun')).toBe('A');
  });
});
