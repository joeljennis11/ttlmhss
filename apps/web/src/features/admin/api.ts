import {
  AcademicYearViewSchema,
  AttendancePolicyViewSchema,
  BehaviourConfigViewSchema,
  CategoryViewSchema,
  ClassViewSchema,
  DayStructureViewSchema,
  ExamListViewSchema,
  ExamSubjectViewSchema,
  ExamViewSchema,
  GradeSchemeViewSchema,
  PermissionsViewSchema,
  RatingLabelViewSchema,
  SchoolSettingsViewSchema,
  SubjectViewSchema,
  type AcademicYearCreate,
  type AcademicYearUpdate,
  type AttendancePolicyUpdate,
  type CategoryCreate,
  type CategoryUpdate,
  type ConfigurableRole,
  type ExamCreate,
  type ExamSubjectInput,
  type ExamUpdate,
  type GradeSchemeInput,
  type Permission,
  type RatingLabelsUpdate,
  type SchoolSettingsUpdate,
  type SubjectCreate,
  type SubjectUpdate,
  type Weekday,
} from '@ttlmhss/shared';
import { z } from 'zod';
import { apiRequest } from '../../lib/api-client';

/*
 * Admin configuration API calls (Phase 4). Every endpoint enforces `config.manage` (or
 * `permissions.manage`) on the server; responses are validated against the shared schemas.
 */

type Signal = AbortSignal | undefined;
const opts = (signal: Signal) => (signal ? { signal } : {});
const Deleted = z.object({ deleted: z.literal(true) });

export const schoolSettings = {
  get: (signal?: Signal) =>
    apiRequest('/admin/school-settings', { schema: SchoolSettingsViewSchema, ...opts(signal) }),
  update: (body: SchoolSettingsUpdate) =>
    apiRequest('/admin/school-settings', { method: 'PUT', body, schema: SchoolSettingsViewSchema }),
};

export const academicYears = {
  list: (signal?: Signal) =>
    apiRequest('/admin/academic-years', {
      schema: z.array(AcademicYearViewSchema),
      ...opts(signal),
    }),
  create: (body: AcademicYearCreate) =>
    apiRequest('/admin/academic-years', { method: 'POST', body, schema: AcademicYearViewSchema }),
  update: (id: string, body: AcademicYearUpdate) =>
    apiRequest(`/admin/academic-years/${id}`, {
      method: 'PATCH',
      body,
      schema: AcademicYearViewSchema,
    }),
  makeCurrent: (id: string) =>
    apiRequest(`/admin/academic-years/${id}/make-current`, {
      method: 'POST',
      schema: AcademicYearViewSchema,
    }),
  setWorkingDays: (id: string, workingDays: Weekday[]) =>
    apiRequest(`/admin/academic-years/${id}/working-days`, {
      method: 'PUT',
      body: { workingDays },
      schema: AcademicYearViewSchema,
    }),
  remove: (id: string) =>
    apiRequest(`/admin/academic-years/${id}`, { method: 'DELETE', schema: Deleted }),
};

export const classes = {
  list: (signal?: Signal) =>
    apiRequest('/admin/classes', { schema: z.array(ClassViewSchema), ...opts(signal) }),
  create: (body: { name: string; displayOrder: number }) =>
    apiRequest('/admin/classes', { method: 'POST', body, schema: ClassViewSchema }),
  update: (id: string, body: { name?: string; displayOrder?: number; status?: string }) =>
    apiRequest(`/admin/classes/${id}`, { method: 'PATCH', body, schema: ClassViewSchema }),
  addSection: (classId: string, name: string) =>
    apiRequest(`/admin/classes/${classId}/sections`, {
      method: 'POST',
      body: { name },
      schema: ClassViewSchema,
    }),
  updateSection: (id: string, body: { name?: string; status?: string }) =>
    apiRequest(`/admin/sections/${id}`, { method: 'PATCH', body, schema: ClassViewSchema }),
};

export const subjects = {
  list: (signal?: Signal) =>
    apiRequest('/admin/subjects', { schema: z.array(SubjectViewSchema), ...opts(signal) }),
  create: (body: SubjectCreate) =>
    apiRequest('/admin/subjects', { method: 'POST', body, schema: SubjectViewSchema }),
  update: (id: string, body: SubjectUpdate) =>
    apiRequest(`/admin/subjects/${id}`, { method: 'PATCH', body, schema: SubjectViewSchema }),
};

export interface SlotInput {
  kind?: 'LESSON' | 'BREAK';
  periodNumber?: number | null;
  label?: string;
  startTime?: string;
  endTime?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export const dayStructure = {
  get: (yearId: string, signal?: Signal) =>
    apiRequest(`/admin/academic-years/${yearId}/day-structure`, {
      schema: DayStructureViewSchema,
      ...opts(signal),
    }),
  create: (yearId: string, body: SlotInput) =>
    apiRequest(`/admin/academic-years/${yearId}/periods`, {
      method: 'POST',
      body,
      schema: DayStructureViewSchema,
    }),
  update: (id: string, body: SlotInput) =>
    apiRequest(`/admin/periods/${id}`, { method: 'PATCH', body, schema: DayStructureViewSchema }),
  remove: (id: string) =>
    apiRequest(`/admin/periods/${id}`, { method: 'DELETE', schema: DayStructureViewSchema }),
  copy: (yearId: string, fromAcademicYearId: string) =>
    apiRequest(`/admin/academic-years/${yearId}/day-structure/copy`, {
      method: 'POST',
      body: { fromAcademicYearId },
      schema: DayStructureViewSchema,
    }),
};

export const attendancePolicy = {
  get: (signal?: Signal) =>
    apiRequest('/admin/attendance-policy', {
      schema: AttendancePolicyViewSchema.nullable(),
      ...opts(signal),
    }),
  save: (body: AttendancePolicyUpdate) =>
    apiRequest('/admin/attendance-policy', {
      method: 'PUT',
      body,
      schema: AttendancePolicyViewSchema,
    }),
};

export const gradeScales = {
  list: (signal?: Signal) =>
    apiRequest('/admin/grade-scales', {
      schema: z.array(GradeSchemeViewSchema),
      ...opts(signal),
    }),
  create: (body: GradeSchemeInput) =>
    apiRequest('/admin/grade-scales', { method: 'POST', body, schema: GradeSchemeViewSchema }),
  update: (id: string, body: GradeSchemeInput) =>
    apiRequest(`/admin/grade-scales/${id}`, {
      method: 'PUT',
      body,
      schema: GradeSchemeViewSchema,
    }),
  remove: (id: string) =>
    apiRequest(`/admin/grade-scales/${id}`, { method: 'DELETE', schema: Deleted }),
};

export const exams = {
  list: (academicYearId: string, signal?: Signal) =>
    apiRequest(`/admin/exams?academicYearId=${encodeURIComponent(academicYearId)}`, {
      schema: ExamListViewSchema,
      ...opts(signal),
    }),
  get: (id: string, signal?: Signal) =>
    apiRequest(`/admin/exams/${id}`, { schema: ExamViewSchema, ...opts(signal) }),
  create: (body: ExamCreate) =>
    apiRequest('/admin/exams', { method: 'POST', body, schema: ExamViewSchema }),
  update: (id: string, body: ExamUpdate) =>
    apiRequest(`/admin/exams/${id}`, { method: 'PATCH', body, schema: ExamViewSchema }),
  remove: (id: string) => apiRequest(`/admin/exams/${id}`, { method: 'DELETE', schema: Deleted }),
  subjects: (examId: string, classId: string, signal?: Signal) =>
    apiRequest(`/admin/exams/${examId}/classes/${classId}/subjects`, {
      schema: z.array(ExamSubjectViewSchema),
      ...opts(signal),
    }),
  setSubjects: (examId: string, classId: string, subjects: ExamSubjectInput[]) =>
    apiRequest(`/admin/exams/${examId}/classes/${classId}/subjects`, {
      method: 'PUT',
      body: { subjects },
      schema: z.array(ExamSubjectViewSchema),
    }),
};

export type CategoryKind = 'behaviour' | 'achievement';
const categoryBase = (kind: CategoryKind) =>
  kind === 'behaviour' ? '/admin/behaviour/categories' : '/admin/achievement-categories';

export const behaviour = {
  get: (signal?: Signal) =>
    apiRequest('/admin/behaviour', { schema: BehaviourConfigViewSchema, ...opts(signal) }),
  setLabels: (body: RatingLabelsUpdate) =>
    apiRequest('/admin/behaviour/rating-labels', {
      method: 'PUT',
      body,
      schema: z.array(RatingLabelViewSchema),
    }),
};

export const categories = {
  list: (kind: CategoryKind, signal?: Signal) =>
    kind === 'behaviour'
      ? behaviour.get(signal).then((b) => b.categories)
      : apiRequest('/admin/achievement-categories', {
          schema: z.array(CategoryViewSchema),
          ...opts(signal),
        }),
  create: (kind: CategoryKind, body: CategoryCreate) =>
    apiRequest(categoryBase(kind), { method: 'POST', body, schema: CategoryViewSchema }),
  update: (kind: CategoryKind, id: string, body: CategoryUpdate) =>
    apiRequest(`${categoryBase(kind)}/${id}`, {
      method: 'PATCH',
      body,
      schema: CategoryViewSchema,
    }),
};

export const permissions = {
  get: (signal?: Signal) =>
    apiRequest('/admin/permissions', { schema: PermissionsViewSchema, ...opts(signal) }),
  setRole: (role: ConfigurableRole, list: Permission[]) =>
    apiRequest(`/admin/permissions/${role}`, {
      method: 'PUT',
      body: { permissions: list },
      schema: PermissionsViewSchema,
    }),
};
