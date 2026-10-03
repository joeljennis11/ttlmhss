import {
  ClassTeacherAssignmentViewSchema,
  ClassTeacherBoardSchema,
  PromotionCandidateSchema,
  PromotionResultSchema,
  StudentListSchema,
  StudentViewSchema,
  TeacherListSchema,
  TeacherViewSchema,
  TemporaryCredentialViewSchema,
  type ClassTeacherAssignInput,
  type PromotionRequestInput,
  type RecordStatus,
  type StudentAdmissionInput,
  type StudentDetailsInput,
  type StudentListQuery,
  type StudentPlacementInput,
  type StudentTransferInput,
  type TeacherCreateInput,
  type TeacherDetailsInput,
  type TeacherListQuery,
} from '@ttlmhss/shared';
import { z } from 'zod';
import { apiRequest } from '../../lib/api-client';

/*
 * Student & teacher management API calls (Phase 5). The server enforces every permission and
 * scope rule; responses are validated against the shared schemas.
 */
type Signal = AbortSignal | undefined;
const opts = (signal: Signal) => (signal ? { signal } : {});
const Deleted = z.object({ deleted: z.literal(true) });

export function queryString(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (typeof v === 'string' || typeof v === 'number') if (v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const studentsApi = {
  list: (query: StudentListQuery, signal?: Signal) =>
    apiRequest(`/admin/students${queryString(query)}`, {
      schema: StudentListSchema,
      ...opts(signal),
    }),
  get: (id: string, signal?: Signal) =>
    apiRequest(`/admin/students/${id}`, { schema: StudentViewSchema, ...opts(signal) }),
  admit: (body: StudentAdmissionInput) =>
    apiRequest('/admin/students', { method: 'POST', body, schema: StudentViewSchema }),
  update: (id: string, body: StudentDetailsInput) =>
    apiRequest(`/admin/students/${id}`, { method: 'PUT', body, schema: StudentViewSchema }),
  setStatus: (id: string, status: RecordStatus, note: string | null = null) =>
    apiRequest(`/admin/students/${id}/status`, {
      method: 'POST',
      body: { status, note },
      schema: StudentViewSchema,
    }),
  transfer: (id: string, body: StudentTransferInput) =>
    apiRequest(`/admin/students/${id}/transfer`, {
      method: 'POST',
      body,
      schema: StudentViewSchema,
    }),
  place: (id: string, body: StudentPlacementInput) =>
    apiRequest(`/admin/students/${id}/placements`, {
      method: 'POST',
      body,
      schema: StudentViewSchema,
    }),
  remove: (id: string) =>
    apiRequest(`/admin/students/${id}`, { method: 'DELETE', schema: Deleted }),
  issuePassword: (id: string) =>
    apiRequest(`/admin/students/${id}/temporary-password`, {
      method: 'POST',
      schema: TemporaryCredentialViewSchema,
    }),
};

export const promotionApi = {
  candidates: (
    q: { sourceAcademicYearId: string; sourceSectionId: string; targetAcademicYearId?: string },
    signal?: Signal,
  ) =>
    apiRequest(`/admin/promotions/candidates${queryString(q)}`, {
      schema: z.array(PromotionCandidateSchema),
      ...opts(signal),
    }),
  promote: (body: PromotionRequestInput) =>
    apiRequest('/admin/promotions', { method: 'POST', body, schema: PromotionResultSchema }),
};

export const teachersApi = {
  list: (query: TeacherListQuery, signal?: Signal) =>
    apiRequest(`/admin/teachers${queryString(query)}`, {
      schema: TeacherListSchema,
      ...opts(signal),
    }),
  designations: (signal?: Signal) =>
    apiRequest('/admin/teachers/designations', { schema: z.array(z.string()), ...opts(signal) }),
  get: (id: string, signal?: Signal) =>
    apiRequest(`/admin/teachers/${id}`, { schema: TeacherViewSchema, ...opts(signal) }),
  create: (body: TeacherCreateInput) =>
    apiRequest('/admin/teachers', { method: 'POST', body, schema: TeacherViewSchema }),
  update: (id: string, body: TeacherDetailsInput) =>
    apiRequest(`/admin/teachers/${id}`, { method: 'PUT', body, schema: TeacherViewSchema }),
  setStatus: (id: string, status: RecordStatus) =>
    apiRequest(`/admin/teachers/${id}/status`, {
      method: 'POST',
      body: { status, note: null },
      schema: TeacherViewSchema,
    }),
  remove: (id: string) =>
    apiRequest(`/admin/teachers/${id}`, { method: 'DELETE', schema: Deleted }),
  assignSubject: (id: string, subjectId: string) =>
    apiRequest(`/admin/teachers/${id}/subjects`, {
      method: 'POST',
      body: { subjectId },
      schema: TeacherViewSchema,
    }),
  removeSubject: (id: string, subjectId: string) =>
    apiRequest(`/admin/teachers/${id}/subjects/${subjectId}`, {
      method: 'DELETE',
      schema: TeacherViewSchema,
    }),
  issuePassword: (id: string) =>
    apiRequest(`/admin/teachers/${id}/temporary-password`, {
      method: 'POST',
      schema: TemporaryCredentialViewSchema,
    }),
};

export const classTeachersApi = {
  board: (academicYearId: string, signal?: Signal) =>
    apiRequest(`/admin/class-teachers${queryString({ academicYearId })}`, {
      schema: ClassTeacherBoardSchema,
      ...opts(signal),
    }),
  assign: (body: ClassTeacherAssignInput) =>
    apiRequest('/admin/class-teachers', {
      method: 'POST',
      body,
      schema: ClassTeacherAssignmentViewSchema,
    }),
  end: (id: string) =>
    apiRequest(`/admin/class-teachers/${id}/end`, {
      method: 'POST',
      schema: ClassTeacherAssignmentViewSchema,
    }),
};
