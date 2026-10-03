import type { Permission } from '@ttlmhss/shared';
import {
  Award,
  CalendarDays,
  CalendarRange,
  Clock,
  ClipboardList,
  Layers,
  Library,
  LockKeyhole,
  Percent,
  School,
  ShieldCheck,
  Smile,
  type LucideIcon,
} from 'lucide-react';

export type AdminPageId =
  | 'settings'
  | 'years'
  | 'calendar'
  | 'classes'
  | 'subjects'
  | 'periods'
  | 'attendance'
  | 'grades'
  | 'exams'
  | 'behaviour'
  | 'achievements'
  | 'permissions';

export interface AdminPageInfo {
  id: AdminPageId;
  /** Path under "/" (used by the router and every admin link). */
  path: string;
  title: string;
  /** Short label for the in-page setup navigation. */
  short: string;
  /** One line for the setup overview. */
  summary: string;
  icon: LucideIcon;
  permission: Permission;
  group: 'School' | 'Teaching rules' | 'Access';
}

/**
 * The Admin configuration pages (Phase 4). One list drives the routes (app/routes.tsx), the
 * setup overview and the in-page setup navigation, so they can never drift apart.
 */
export const ADMIN_PAGES: readonly AdminPageInfo[] = [
  {
    id: 'settings',
    path: 'admin/school',
    title: 'School details',
    short: 'School',
    summary: 'Name, contact details, motto and logo.',
    icon: School,
    permission: 'config.manage',
    group: 'School',
  },
  {
    id: 'years',
    path: 'admin/academic-years',
    title: 'Academic years',
    short: 'Years',
    summary: 'Year dates, the current year and working days.',
    icon: CalendarRange,
    permission: 'config.manage',
    group: 'School',
  },
  {
    id: 'calendar',
    path: 'admin/academic-calendar',
    title: 'Academic calendar',
    short: 'Calendar',
    summary: 'Holidays and special working days, for the whole school or some classes.',
    icon: CalendarDays,
    permission: 'config.manage',
    group: 'School',
  },
  {
    id: 'classes',
    path: 'admin/classes',
    title: 'Classes & sections',
    short: 'Classes',
    summary: 'The classes the school runs and their sections.',
    icon: Layers,
    permission: 'config.manage',
    group: 'School',
  },
  {
    id: 'subjects',
    path: 'admin/subjects',
    title: 'Subjects',
    short: 'Subjects',
    summary: 'The subject list used by timetables, teachers and exams.',
    icon: Library,
    permission: 'config.manage',
    group: 'School',
  },
  {
    id: 'periods',
    path: 'admin/periods',
    title: 'Periods & breaks',
    short: 'Periods',
    summary: 'The school day: period times and breaks for each year.',
    icon: Clock,
    permission: 'config.manage',
    group: 'School',
  },
  {
    id: 'attendance',
    path: 'admin/attendance-locking',
    title: 'Attendance locking',
    short: 'Attendance',
    summary: 'How long attendance stays editable after each month.',
    icon: LockKeyhole,
    permission: 'config.manage',
    group: 'Teaching rules',
  },
  {
    id: 'grades',
    path: 'admin/grade-scales',
    title: 'Grade scales',
    short: 'Grades',
    summary: 'Percentage ranges for each grade.',
    icon: Percent,
    permission: 'config.manage',
    group: 'Teaching rules',
  },
  {
    id: 'exams',
    path: 'admin/exams',
    title: 'Exams',
    short: 'Exams',
    summary: 'Exams per year, weightage and subject marks.',
    icon: ClipboardList,
    permission: 'config.manage',
    group: 'Teaching rules',
  },
  {
    id: 'behaviour',
    path: 'admin/behaviour',
    title: 'Behaviour',
    short: 'Behaviour',
    summary: 'Behaviour categories and the meaning of ratings 1–5.',
    icon: Smile,
    permission: 'config.manage',
    group: 'Teaching rules',
  },
  {
    id: 'achievements',
    path: 'admin/achievement-categories',
    title: 'Achievement categories',
    short: 'Achievements',
    summary: 'Categories for recording student achievements.',
    icon: Award,
    permission: 'config.manage',
    group: 'Teaching rules',
  },
  {
    id: 'permissions',
    path: 'admin/permissions',
    title: 'Role permissions',
    short: 'Permissions',
    summary: 'What teachers, class teachers and students may do.',
    icon: ShieldCheck,
    permission: 'permissions.manage',
    group: 'Access',
  },
];

export function adminPage(id: AdminPageId): AdminPageInfo {
  return ADMIN_PAGES.find((p) => p.id === id)!;
}

export const adminHref = (id: AdminPageId) => `/${adminPage(id).path}`;
