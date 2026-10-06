import {
  API_PREFIX,
  AnnualReportListSchema,
  AnnualReportViewSchema,
  ClassAttendanceReportSchema,
  ExamReportCardSchema,
  MyAnnualReportsSchema,
  PerformanceReportSchema,
  ReportOptionsSchema,
  type AnnualReportRemark,
} from '@ttlmhss/shared';
import { ApiClientError, apiRequest } from '../../lib/api-client';
import { queryString } from '../people/api';

/*
 * Phase 11 report calls. JSON documents feed the on-screen previews; the same endpoints with
 * `format=pdf` / `format=xlsx` return the generated file, built by the server from that document.
 */
type Signal = AbortSignal | undefined;
const opts = (signal: Signal) => (signal ? { signal } : {});
type Params = Record<string, string | undefined>;

export const reportPaths = {
  examCard: (p: { examId: string; studentId?: string }) => `/reports/exam-card${queryString(p)}`,
  markSheet: (p: { examSubjectId: string; sectionId: string }) =>
    `/reports/mark-sheet${queryString(p)}`,
  studentAttendance: (p: { studentId?: string; from: string; to: string }) =>
    `/reports/attendance/student${queryString(p)}`,
  classAttendance: (p: { sectionId: string; from: string; to: string }) =>
    `/reports/attendance/class${queryString(p)}`,
  performance: (p: { studentId?: string; academicYearId?: string }) =>
    `/reports/performance${queryString(p)}`,
  annual: (p: { academicYearId: string; studentId?: string }) => `/reports/annual${queryString(p)}`,
};

/** Adds `format` to a report path. */
export const withFormat = (path: string, format: 'pdf' | 'xlsx') =>
  `${path}${path.includes('?') ? '&' : '?'}format=${format}`;

export const reportsApi = {
  options: (academicYearId: string | null, signal?: Signal) =>
    apiRequest(`/reports/options${queryString({ academicYearId: academicYearId ?? undefined })}`, {
      schema: ReportOptionsSchema,
      ...opts(signal),
    }),
  examCard: (p: { examId: string; studentId?: string }, signal?: Signal) =>
    apiRequest(reportPaths.examCard(p), { schema: ExamReportCardSchema, ...opts(signal) }),
  classAttendance: (p: { sectionId: string; from: string; to: string }, signal?: Signal) =>
    apiRequest(reportPaths.classAttendance(p), {
      schema: ClassAttendanceReportSchema,
      ...opts(signal),
    }),
  performance: (p: Params, signal?: Signal) =>
    apiRequest(reportPaths.performance(p), { schema: PerformanceReportSchema, ...opts(signal) }),
  annual: (p: { academicYearId: string; studentId?: string }, signal?: Signal) =>
    apiRequest(reportPaths.annual(p), { schema: AnnualReportViewSchema, ...opts(signal) }),
  annualList: (academicYearId: string, sectionId: string, signal?: Signal) =>
    apiRequest(`/reports/annual/section${queryString({ academicYearId, sectionId })}`, {
      schema: AnnualReportListSchema,
      ...opts(signal),
    }),
  myAnnual: (signal?: Signal) =>
    apiRequest('/reports/annual/mine', { schema: MyAnnualReportsSchema, ...opts(signal) }),
  prepare: (academicYearId: string, studentId: string) =>
    apiRequest('/reports/annual', {
      method: 'POST',
      body: { academicYearId, studentId },
      schema: AnnualReportViewSchema,
    }),
  remark: (id: string, body: AnnualReportRemark) =>
    apiRequest(`/reports/annual/${id}/remark`, {
      method: 'PUT',
      body,
      schema: AnnualReportViewSchema,
    }),
  step: (id: string, step: 'finalize' | 'publish' | 'unpublish', revision: number) =>
    apiRequest(`/reports/annual/${id}/${step}`, {
      method: 'POST',
      body: { revision },
      schema: AnnualReportViewSchema,
    }),
  reopen: (id: string, revision: number, reason: string) =>
    apiRequest(`/reports/annual/${id}/reopen`, {
      method: 'POST',
      body: { revision, reason },
      schema: AnnualReportViewSchema,
    }),
};

/**
 * Downloads a generated report file (PDF / XLSX) and saves it under the server's file name.
 * Errors (e.g. "This result is incomplete") come back as the API's message.
 */
export async function downloadReport(path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, { credentials: 'include' });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', 'Cannot reach the server. Check your connection.', 0);
  }
  if (!response.ok) {
    let message = 'The report could not be generated.';
    let code = 'ERROR';
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } };
      message = body.error?.message ?? message;
      code = body.error?.code ?? code;
    } catch {
      // not JSON
    }
    throw new ApiClientError(code, message, response.status);
  }
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
    'report.pdf';
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
