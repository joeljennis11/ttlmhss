import type { AuthUser, EffectiveRole } from '@ttlmhss/shared';

export const ROLE_LABELS: Readonly<Record<EffectiveRole, string>> = {
  ADMIN: 'Administrator',
  TEACHER: 'Teacher',
  CLASS_TEACHER: 'Class Teacher',
  STUDENT: 'Student',
};

/** "Teacher and Class Teacher", "Administrator", … */
export function describeRoles(user: Pick<AuthUser, 'roles'>): string {
  const labels = user.roles.map((role) => ROLE_LABELS[role]);
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    : (labels[0] ?? '');
}

/** The most specific role, for compact badges (Class Teacher over Teacher). */
export function primaryRoleLabel(user: Pick<AuthUser, 'roles'>): string {
  const order: EffectiveRole[] = ['ADMIN', 'CLASS_TEACHER', 'TEACHER', 'STUDENT'];
  const role = order.find((r) => user.roles.includes(r));
  return role ? ROLE_LABELS[role] : '';
}

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s.]+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [name[0]];
  return letters.join('').toUpperCase();
}
