import type { ReactElement } from 'react';
import type { EffectiveRole, Permission } from '@ttlmhss/shared';
import {
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  House,
  KeyRound,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { HomePage } from '../pages/HomePage';
import { AccountPasswordPage } from '../pages/AccountPasswordPage';
import { ADMIN_PAGES, type AdminPageId } from '../features/admin/admin-pages';
import { AdminHubPage } from '../features/admin/pages/AdminHubPage';
import { AcademicCalendarPage } from '../features/admin/pages/AcademicCalendarPage';
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
import { ClassTeachersPage } from '../features/people/pages/ClassTeachersPage';
import { PromotionPage } from '../features/people/pages/PromotionPage';
import { StudentFormPage } from '../features/people/pages/StudentFormPage';
import { StudentProfilePage } from '../features/people/pages/StudentProfilePage';
import { StudentsPage } from '../features/people/pages/StudentsPage';
import { TeacherFormPage } from '../features/people/pages/TeacherFormPage';
import { TeacherProfilePage } from '../features/people/pages/TeacherProfilePage';
import { TeachersPage } from '../features/people/pages/TeachersPage';
import { AttendanceHome } from '../features/attendance/attendance-shared';
import { ClassAttendancePage } from '../features/attendance/pages/ClassAttendancePage';
import { MyAttendancePage } from '../features/attendance/pages/MyAttendancePage';
import { MyLessonsPage } from '../features/attendance/pages/MyLessonsPage';
import { RegisterPage } from '../features/attendance/pages/RegisterPage';
import { RegistersPage } from '../features/attendance/pages/RegistersPage';
import { TimetableHome } from '../features/timetable/TimetableLayout';
import { TimetableEditorPage } from '../features/timetable/pages/EditorPage';
import { ClassTimetablePage, MyTimetablePage } from '../features/timetable/pages/ViewPages';

export type NavSection = 'main' | 'management' | 'admin' | 'account';

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
  calendar: <AcademicCalendarPage />,
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
  // Phase 6 — Timetable (staff screens; the student timetable view arrives with the portal).
  {
    path: 'timetable',
    title: 'Timetable',
    element: <TimetableHome />,
    permission: 'timetable.view',
    roles: ['ADMIN', 'TEACHER'],
    nav: { label: 'Timetable', icon: CalendarDays, section: 'main', end: false },
  },
  {
    path: 'timetable/my',
    title: 'My timetable',
    element: <MyTimetablePage />,
    permission: 'timetable.view',
    roles: ['TEACHER'],
  },
  {
    path: 'timetable/classes',
    title: 'Class timetables',
    element: <ClassTimetablePage />,
    permission: 'timetable.view',
    roles: ['ADMIN', 'TEACHER'],
  },
  {
    path: 'timetable/edit',
    title: 'Edit timetable',
    element: <TimetableEditorPage />,
    permission: 'timetable.manage',
  },
  // Phase 7 — Attendance (period-wise; scope is decided by the API from the timetable).
  {
    path: 'attendance',
    title: 'Attendance',
    element: <AttendanceHome />,
    permission: 'attendance.view',
    nav: { label: 'Attendance', icon: ClipboardCheck, section: 'main', end: false },
  },
  {
    path: 'attendance/lessons',
    title: 'My lessons',
    element: <MyLessonsPage />,
    permission: 'attendance.mark',
    roles: ['TEACHER'],
  },
  {
    path: 'attendance/register',
    title: 'Attendance register',
    element: <RegisterPage />,
    permission: 'attendance.view',
    roles: ['ADMIN', 'TEACHER'],
  },
  {
    path: 'attendance/class',
    title: 'Class attendance',
    element: <ClassAttendancePage />,
    permission: 'attendance.manage',
  },
  {
    path: 'attendance/registers',
    title: 'All registers',
    element: <RegistersPage />,
    permission: 'attendance.view',
    roles: ['ADMIN'],
  },
  {
    path: 'attendance/me',
    title: 'My attendance',
    element: <MyAttendancePage />,
    permission: 'attendance.view',
    roles: ['STUDENT'],
  },
  // Phase 5 — Student & teacher management (administrator screens; permissions are admin-only
  // management actions, so the menu shows them to administrators).
  {
    path: 'students',
    title: 'Students',
    element: <StudentsPage />,
    permission: 'students.create',
    nav: { label: 'Students', icon: Users, section: 'management' },
  },
  {
    path: 'students/new',
    title: 'Admit student',
    element: <StudentFormPage />,
    permission: 'students.create',
  },
  {
    path: 'students/promotion',
    title: 'Promote students',
    element: <PromotionPage />,
    permission: 'students.promote',
  },
  {
    path: 'students/:id',
    title: 'Student',
    element: <StudentProfilePage />,
    permission: 'students.create',
  },
  {
    path: 'students/:id/edit',
    title: 'Edit student',
    element: <StudentFormPage />,
    permission: 'students.edit',
  },
  {
    path: 'teachers',
    title: 'Teachers',
    element: <TeachersPage />,
    permission: 'teachers.create',
    nav: { label: 'Teachers', icon: GraduationCap, section: 'management' },
  },
  {
    path: 'teachers/new',
    title: 'Add teacher',
    element: <TeacherFormPage />,
    permission: 'teachers.create',
  },
  {
    path: 'teachers/:id',
    title: 'Teacher',
    element: <TeacherProfilePage />,
    permission: 'teachers.create',
  },
  {
    path: 'teachers/:id/edit',
    title: 'Edit teacher',
    element: <TeacherFormPage />,
    permission: 'teachers.edit',
  },
  {
    path: 'class-teachers',
    title: 'Class teachers',
    element: <ClassTeachersPage />,
    permission: 'class_teacher_assignments.manage',
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
