import {
  ClassResultViewSchema,
  ExamMarksMatrixViewSchema,
  MarkHistoryEntrySchema,
  MarkSheetViewSchema,
  MarksHomeViewSchema,
  ResultExamsViewSchema,
  StudentExamResultViewSchema,
  type ExamStage,
  type MarkSheetKey,
  type MarkSheetSave,
  type MarkSheetSubmit,
  type MarkSheetUnlock,
} from '@ttlmhss/shared';
import { z } from 'zod';
import { apiRequest } from '../../lib/api-client';
import { queryString } from '../people/api';

/*
 * Exams, marks and results API calls (Phase 8B). The server decides who may see or change each
 * mark sheet and computes every result; the browser only shows what it returns.
 */
type Signal = AbortSignal | undefined;
const opts = (signal: Signal) => (signal ? { signal } : {});

export const marksApi = {
  home: (academicYearId: string | null, signal?: Signal) =>
    apiRequest(`/marks${queryString({ academicYearId: academicYearId ?? undefined })}`, {
      schema: MarksHomeViewSchema,
      ...opts(signal),
    }),
  sheet: (key: MarkSheetKey, signal?: Signal) =>
    apiRequest(`/marks/sheet${queryString(key)}`, { schema: MarkSheetViewSchema, ...opts(signal) }),
  history: (key: MarkSheetKey, signal?: Signal) =>
    apiRequest(`/marks/sheet/history${queryString(key)}`, {
      schema: z.array(MarkHistoryEntrySchema),
      ...opts(signal),
    }),
  save: (body: MarkSheetSave) =>
    apiRequest('/marks/sheet', { method: 'PUT', body, schema: MarkSheetViewSchema }),
  submit: (body: MarkSheetSubmit) =>
    apiRequest('/marks/sheet/submit', { method: 'POST', body, schema: MarkSheetViewSchema }),
  unlock: (body: MarkSheetUnlock) =>
    apiRequest('/marks/sheet/unlock', { method: 'POST', body, schema: MarkSheetViewSchema }),
};

export const examAdminApi = {
  matrix: (examId: string, signal?: Signal) =>
    apiRequest(`/admin/exams/${examId}/mark-sheets`, {
      schema: ExamMarksMatrixViewSchema,
      ...opts(signal),
    }),
  setStage: (examId: string, stage: ExamStage) =>
    apiRequest(`/admin/exams/${examId}/stage`, {
      method: 'PUT',
      body: { stage },
      schema: ExamMarksMatrixViewSchema,
    }),
  setTeacher: (examSubjectId: string, sectionId: string, teacherId: string | null) =>
    apiRequest(`/admin/exam-subjects/${examSubjectId}/sections/${sectionId}/teacher`, {
      method: 'PUT',
      body: { teacherId },
      schema: ExamMarksMatrixViewSchema,
    }),
};

export const resultsApi = {
  myExams: (academicYearId: string | null, signal?: Signal) =>
    apiRequest(`/results/me${queryString({ academicYearId: academicYearId ?? undefined })}`, {
      schema: ResultExamsViewSchema,
      ...opts(signal),
    }),
  mine: (examId: string, signal?: Signal) =>
    apiRequest(`/results/me/exams/${examId}`, {
      schema: StudentExamResultViewSchema,
      ...opts(signal),
    }),
  options: (academicYearId: string | null, signal?: Signal) =>
    apiRequest(`/results/options${queryString({ academicYearId: academicYearId ?? undefined })}`, {
      schema: ResultExamsViewSchema,
      ...opts(signal),
    }),
  classResult: (examId: string, sectionId: string, signal?: Signal) =>
    apiRequest(`/results/exams/${examId}/sections/${sectionId}`, {
      schema: ClassResultViewSchema,
      ...opts(signal),
    }),
  student: (examId: string, studentId: string, signal?: Signal) =>
    apiRequest(`/results/exams/${examId}/students/${studentId}`, {
      schema: StudentExamResultViewSchema,
      ...opts(signal),
    }),
};
