import {
  AttendanceClassDayViewSchema,
  AttendanceClassSummaryViewSchema,
  AttendanceLessonsViewSchema,
  AttendanceRegisterViewSchema,
  AttendanceSessionListSchema,
  AttendanceStudentDayViewSchema,
  StudentAttendanceViewSchema,
  TimetableSectionListSchema,
  type AttendanceSaveInput,
  type AttendanceSessionListQuery,
  type AttendanceStudentDaySaveInput,
} from '@ttlmhss/shared';
import { apiRequest } from '../../lib/api-client';
import { queryString } from '../people/api';

/*
 * Attendance API calls (Phase 7). The server resolves the lesson from the timetable and decides
 * every permission, scope and cutoff rule; the browser only shows what it returns.
 */
type Signal = AbortSignal | undefined;
const opts = (signal: Signal) => (signal ? { signal } : {});

export const attendanceApi = {
  register: (date: string, periodId: string, sectionId: string, signal?: Signal) =>
    apiRequest(`/attendance/register${queryString({ date, periodId, sectionId })}`, {
      schema: AttendanceRegisterViewSchema,
      ...opts(signal),
    }),
  save: (body: AttendanceSaveInput) =>
    apiRequest('/attendance/register', {
      method: 'PUT',
      body,
      schema: AttendanceRegisterViewSchema,
    }),
  lessons: (date: string, signal?: Signal) =>
    apiRequest(`/attendance/lessons${queryString({ date })}`, {
      schema: AttendanceLessonsViewSchema,
      ...opts(signal),
    }),
  classes: (academicYearId: string, signal?: Signal) =>
    apiRequest(`/attendance/classes${queryString({ academicYearId })}`, {
      schema: TimetableSectionListSchema,
      ...opts(signal),
    }),
  classDay: (sectionId: string, date: string, signal?: Signal) =>
    apiRequest(`/attendance/class-day${queryString({ sectionId, date })}`, {
      schema: AttendanceClassDayViewSchema,
      ...opts(signal),
    }),
  classSummary: (sectionId: string, from: string, to: string, signal?: Signal) =>
    apiRequest(`/attendance/class-summary${queryString({ sectionId, from, to })}`, {
      schema: AttendanceClassSummaryViewSchema,
      ...opts(signal),
    }),
  studentDay: (studentId: string, date: string, signal?: Signal) =>
    apiRequest(`/attendance/student-day${queryString({ studentId, date })}`, {
      schema: AttendanceStudentDayViewSchema,
      ...opts(signal),
    }),
  saveStudentDay: (body: AttendanceStudentDaySaveInput) =>
    apiRequest('/attendance/student-day', {
      method: 'PUT',
      body,
      schema: AttendanceStudentDayViewSchema,
    }),
  me: (from: string, to: string, signal?: Signal) =>
    apiRequest(`/attendance/me${queryString({ from, to })}`, {
      schema: StudentAttendanceViewSchema,
      ...opts(signal),
    }),
  sessions: (query: AttendanceSessionListQuery, signal?: Signal) =>
    apiRequest(`/attendance/sessions${queryString(query as Record<string, unknown>)}`, {
      schema: AttendanceSessionListSchema,
      ...opts(signal),
    }),
};

/** Link to a lesson's register (the server decides whether the user may open it). */
export const registerHref = (date: string, periodId: string, sectionId: string) =>
  `/attendance/register${queryString({ date, periodId, sectionId })}`;
