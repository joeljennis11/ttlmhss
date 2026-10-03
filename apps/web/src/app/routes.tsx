import type { ReactElement } from 'react';
import type { EffectiveRole, Permission } from '@ttlmhss/shared';
import { House, KeyRound, Settings, type LucideIcon } from 'lucide-react';
import { HomePage } from '../pages/HomePage';
import { AccountPasswordPage } from '../pages/AccountPasswordPage';
import { ADMIN_PAGES, type AdminPageId } from '../features/admin/admin-pages';
import { AdminHubPage } from '../features/admin/pages/AdminHubPage';
import { AcademicYearsPage } from '../features/admin/pages/AcademicYearsPage';
import { AchievementCategoriesPage } from '../features/admin/pages/AchievementCategoriesPage';
import { AttendancePolicyPage } from '../features/admin/pages/AttendancePolicyPage';
import { BehaviourPage } from '../features/admin/pages/BehaviourPage';
import { ClassesPage } from '../features/admin/pages/ClassesPage';
import { ExamDetailPage } from '../features/admin/pages/ExamDetailPage';
import { ExamsPage } from '../features/admin/pages/ExamsPage';
import { GradeScalesPage } from '../features/admin/pages/GradeScalesPage';
import { PeriodsPage } from '../features/admin/pages/PeriodsPage';
import { PermissionsPage } from '../features/admin/pages/PermissionsPage';
import { SchoolSettingsPage } from '../features/admin/pages/SchoolSettingsPage';
import { SubjectsPage } from '../features/admin/pages/SubjectsPage';

export type NavSection = 'main' | 'admin' | 'account';

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
  /** `end`: highlight only on this exact path, not on pages below it. */
  nav?: { label: string; icon: LucideIcon; section: NavSection; end?: boolean };
}

const ADMIN_ELEMENTS: Record<AdminPageId, ReactElement> = {
  settings: <SchoolSettingsPage />,
  years: <AcademicYearsPage />,
  classes: <ClassesPage />,
  subjects: <SubjectsPage />,
  periods: <PeriodsPage />,
  attendance: <AttendancePolicyPage />,
  grades: <GradeScalesPage />,
  exams: <ExamsPage />,
  behaviour: <BehaviourPage />,
  achievements: <AchievementCategoriesPage />,
  permissions: <PermissionsPage />,
};

export const SHELL_ROUTES: readonly ShellRoute[] = [
  {
    path: '',
    title: 'Home',
    element: <HomePage />,
    nav: { label: 'Home', icon: House, section: 'main' },
  },
  // Phase 4 — Admin configuration
  {
    path: 'admin',
    title: 'School setup',
    element: <AdminHubPage />,
    permission: 'config.manage',
    // One menu entry for the whole area (stays highlighted on every setup page); the setup
    // pages link to each other through the in-page setup navigation.
    nav: { label: 'School setup', icon: Settings, section: 'admin' },
  },
  ...ADMIN_PAGES.map((page): ShellRoute => ({
    path: page.path,
    title: page.title,
    element: ADMIN_ELEMENTS[page.id],
    permission: page.permission,
  })),
  {
    path: 'admin/exams/:examId',
    title: 'Exam',
    element: <ExamDetailPage />,
    permission: 'config.manage',
  },
  {
    path: 'account/password',
    title: 'Change password',
    element: <AccountPasswordPage />,
    nav: { label: 'Change password', icon: KeyRound, section: 'account' },
  },
];
