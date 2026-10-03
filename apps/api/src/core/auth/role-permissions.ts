import {
  CONFIGURABLE_ROLES,
  PERMISSIONS,
  grantableTo,
  type ConfigurableRole,
  type EffectiveRole,
  type Permission,
} from '@ttlmhss/shared';

/**
 * Role → permission grants (code-defined, version-controlled; docs/permissions.md, D-15).
 *
 * A permission says what KIND of action a role may attempt. It is never sufficient on its own for
 * record-level access: services must also check scope (own class, own periods, self) through
 * AuthorizationService. E.g. TEACHER holds `students.view`, but only for students in their scope.
 *
 * CLASS_TEACHER grants are ADDED to TEACHER grants for a teacher holding an active class-teacher
 * assignment, and apply only within that class/section.
 */
/** Built-in defaults. Administrators can adjust non-admin roles within each role's ceiling. */
const TEACHER: readonly Permission[] = [
  'config.view',
  'students.view',
  'timetable.view',
  'attendance.view',
  'attendance.mark',
  'exams.view',
  'marks.view',
  'marks.enter',
  'marks.submit',
  'results.view',
  'announcements.view',
  'reports.view',
];

const CLASS_TEACHER: readonly Permission[] = [
  'students.edit',
  'attendance.manage',
  'marks.edit',
  'behaviour.view',
  'behaviour.manage',
  'achievements.view',
  'achievements.manage',
  'announcements.manage',
  'requests.view',
  'requests.handle',
  'reports.generate',
];

const STUDENT: readonly Permission[] = [
  'students.view',
  'timetable.view',
  'attendance.view',
  'exams.view',
  'marks.view',
  'results.view',
  'behaviour.view',
  'achievements.view',
  'announcements.view',
  'requests.view',
  'requests.create',
  'reports.view',
];

export const ROLE_PERMISSIONS: Readonly<Record<EffectiveRole, readonly Permission[]>> =
  Object.freeze({
    ADMIN: PERMISSIONS,
    TEACHER,
    CLASS_TEACHER,
    STUDENT,
  });

/** Built-in defaults only (no administrator adjustments). */
export function permissionsFor(roles: readonly EffectiveRole[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}

// ---------------------------------------------------------------------------
// Administrator adjustments (Phase 4)
// ---------------------------------------------------------------------------

/** Effective grants per role after administrator adjustments. */
export type RolePermissionTable = Readonly<Record<EffectiveRole, ReadonlySet<Permission>>>;

export interface PermissionOverrideLike {
  role: ConfigurableRole;
  permission: Permission;
  effect: 'GRANT' | 'REVOKE';
}

/**
 * defaults ∪ grants − revokes, then CLIPPED to the role's ceiling (PERMISSION_INFO.grantableTo).
 * The clip is applied here as well as on save, so even a row written directly into the database
 * cannot give a teacher or student an administrator-only permission. ADMIN is never adjustable.
 */
export function buildRolePermissionTable(
  overrides: readonly PermissionOverrideLike[],
): RolePermissionTable {
  const table = {} as Record<EffectiveRole, ReadonlySet<Permission>>;
  table.ADMIN = new Set(PERMISSIONS);
  for (const role of CONFIGURABLE_ROLES) {
    const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
    for (const o of overrides) {
      if (o.role !== role) continue;
      if (o.effect === 'GRANT') set.add(o.permission);
      else set.delete(o.permission);
    }
    const ceiling = new Set(grantableTo(role));
    table[role] = new Set([...set].filter((p) => ceiling.has(p)));
  }
  return Object.freeze(table);
}

export function effectivePermissions(
  table: RolePermissionTable,
  roles: readonly EffectiveRole[],
): ReadonlySet<Permission> {
  return new Set(roles.flatMap((role) => [...table[role]]));
}

/**
 * Supplies the current table to authentication. Cached in memory for a short time and invalidated
 * immediately when an administrator saves changes in this process (other processes converge
 * within the TTL).
 */
export class RolePermissionService {
  private cached: { table: RolePermissionTable; at: number } | null = null;

  constructor(
    private readonly load: () => Promise<readonly PermissionOverrideLike[]>,
    private readonly ttlMs = 30_000,
  ) {}

  async table(): Promise<RolePermissionTable> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < this.ttlMs) return this.cached.table;
    const table = buildRolePermissionTable(await this.load());
    this.cached = { table, at: now };
    return table;
  }

  invalidate(): void {
    this.cached = null;
  }
}
