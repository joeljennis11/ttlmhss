import {
  ClassTimetableViewSchema,
  TeacherTimetableViewSchema,
  TimetableEditorViewSchema,
  TimetableOptionsSchema,
  TimetableSectionListSchema,
  TimetableVersionListSchema,
  TimetableVersionViewSchema,
  TimetableYearListSchema,
  TimetableRequestListSchema,
  TimetableRequestOptionsSchema,
  TimetableRequestViewSchema,
  type TimetableOperation,
  type TimetableRequestCreate,
} from '@ttlmhss/shared';
import { z } from 'zod';
import { apiRequest } from '../../lib/api-client';

/*
 * Timetable API calls (Phase 6). The server validates every change (conflicts, Teacher → Subject,
 * breaks, working days) and enforces permissions and class scope; the browser only shows results.
 */
type Signal = AbortSignal | undefined;
const opts = (signal: Signal) => (signal ? { signal } : {});
const year = (id: string) => `/timetable/years/${id}`;

export const timetableApi = {
  years: (signal?: Signal) =>
    apiRequest('/timetable/years', { schema: TimetableYearListSchema, ...opts(signal) }),
  editor: (yearId: string, sectionId: string, signal?: Signal) =>
    apiRequest(`${year(yearId)}/editor?sectionId=${encodeURIComponent(sectionId)}`, {
      schema: TimetableEditorViewSchema,
      ...opts(signal),
    }),
  options: (yearId: string, signal?: Signal) =>
    apiRequest(`${year(yearId)}/options`, { schema: TimetableOptionsSchema, ...opts(signal) }),
  versions: (yearId: string, signal?: Signal) =>
    apiRequest(`${year(yearId)}/versions`, {
      schema: TimetableVersionListSchema,
      ...opts(signal),
    }),
  startDraft: (yearId: string) =>
    apiRequest(`${year(yearId)}/draft`, { method: 'POST', schema: TimetableVersionViewSchema }),
  /** Apply (or, with dryRun, only validate) a batch of changes to the draft. */
  changes: (yearId: string, sectionId: string, operations: TimetableOperation[], dryRun: boolean) =>
    apiRequest(`${year(yearId)}/draft/changes`, {
      method: 'POST',
      body: { sectionId, operations, dryRun },
      schema: TimetableEditorViewSchema,
    }),
  publish: (yearId: string) =>
    apiRequest(`${year(yearId)}/draft/publish`, {
      method: 'POST',
      schema: TimetableVersionViewSchema,
    }),
  discardDraft: (yearId: string) =>
    apiRequest(`${year(yearId)}/draft`, {
      method: 'DELETE',
      schema: z.object({ deleted: z.literal(true) }),
    }),

  sections: (yearId: string, signal?: Signal) =>
    apiRequest(`${year(yearId)}/sections`, {
      schema: TimetableSectionListSchema,
      ...opts(signal),
    }),
  classTimetable: (yearId: string, sectionId: string, signal?: Signal) =>
    apiRequest(`${year(yearId)}/sections/${sectionId}`, {
      schema: ClassTimetableViewSchema,
      ...opts(signal),
    }),
  myTimetable: (yearId: string, signal?: Signal) =>
    apiRequest(`/timetable/me?academicYearId=${encodeURIComponent(yearId)}`, {
      schema: TeacherTimetableViewSchema,
      ...opts(signal),
    }),
};

/** Timetable change requests (Phase 12C): class teachers ask, administrators approve or decline. */
export const timetableRequestsApi = {
  options: (yearId: string | null, signal?: Signal) =>
    apiRequest(
      `/timetable/change-requests/options${yearId ? `?academicYearId=${encodeURIComponent(yearId)}` : ''}`,
      { schema: TimetableRequestOptionsSchema, ...opts(signal) },
    ),
  list: (status: string, signal?: Signal) =>
    apiRequest(`/timetable/change-requests?status=${encodeURIComponent(status)}`, {
      schema: TimetableRequestListSchema,
      ...opts(signal),
    }),
  create: (body: TimetableRequestCreate) =>
    apiRequest('/timetable/change-requests', {
      method: 'POST',
      body,
      schema: TimetableRequestViewSchema,
    }),
  approve: (id: string, revision: number, note: string | null) =>
    apiRequest(`/timetable/change-requests/${id}/approve`, {
      method: 'POST',
      body: { revision, note },
      schema: TimetableRequestViewSchema,
    }),
  decline: (id: string, revision: number, note: string) =>
    apiRequest(`/timetable/change-requests/${id}/decline`, {
      method: 'POST',
      body: { revision, note },
      schema: TimetableRequestViewSchema,
    }),
  withdraw: (id: string, revision: number) =>
    apiRequest(`/timetable/change-requests/${id}/withdraw`, {
      method: 'POST',
      body: { revision },
      schema: TimetableRequestViewSchema,
    }),
};
