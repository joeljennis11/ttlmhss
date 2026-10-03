import {
  ClassTimetableViewSchema,
  TeacherTimetableViewSchema,
  TimetableEditorViewSchema,
  TimetableOptionsSchema,
  TimetableSectionListSchema,
  TimetableVersionListSchema,
  TimetableVersionViewSchema,
  TimetableYearListSchema,
  type TimetableOperation,
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
