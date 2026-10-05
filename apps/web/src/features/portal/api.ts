import {
  AchievementListSchema,
  AchievementOptionsViewSchema,
  AchievementViewSchema,
  BehaviourOptionsViewSchema,
  BehaviourSheetViewSchema,
  MarkHistoryEntrySchema,
  PortalProfileViewSchema,
  StudentBehaviourListSchema,
  StudentTimetableViewSchema,
  type AchievementCreate,
  type AchievementListQuery,
  type AchievementUpdate,
  type BehaviourSheetKey,
  type BehaviourSheetSave,
  type BehaviourSheetSubmit,
} from '@ttlmhss/shared';
import { z } from 'zod';
import { apiRequest } from '../../lib/api-client';
import { queryString } from '../people/api';

/*
 * Phase 9 API calls: the student's own portal data, behaviour sheets and achievements. The server
 * decides scope and visibility; the browser shows what it returns.
 */
type Signal = AbortSignal | undefined;
const opts = (signal: Signal) => (signal ? { signal } : {});
const year = (academicYearId: string | null | undefined) =>
  queryString({ academicYearId: academicYearId ?? undefined });

export const portalApi = {
  profile: (signal?: Signal) =>
    apiRequest('/portal/profile', { schema: PortalProfileViewSchema, ...opts(signal) }),
  behaviour: (academicYearId: string | null, signal?: Signal) =>
    apiRequest(`/portal/behaviour${year(academicYearId)}`, {
      schema: StudentBehaviourListSchema,
      ...opts(signal),
    }),
  achievements: (signal?: Signal) =>
    apiRequest('/portal/achievements', { schema: AchievementListSchema, ...opts(signal) }),
  timetable: (studentId: string, signal?: Signal) =>
    apiRequest(`/timetable/students/${studentId}`, {
      schema: StudentTimetableViewSchema,
      ...opts(signal),
    }),
};

export const behaviourApi = {
  options: (academicYearId: string | null, signal?: Signal) =>
    apiRequest(`/behaviour/options${year(academicYearId)}`, {
      schema: BehaviourOptionsViewSchema,
      ...opts(signal),
    }),
  sheet: (key: BehaviourSheetKey, signal?: Signal) =>
    apiRequest(`/behaviour/sheet${queryString(key)}`, {
      schema: BehaviourSheetViewSchema,
      ...opts(signal),
    }),
  history: (key: BehaviourSheetKey, signal?: Signal) =>
    apiRequest(`/behaviour/sheet/history${queryString(key)}`, {
      schema: z.array(MarkHistoryEntrySchema),
      ...opts(signal),
    }),
  save: (body: BehaviourSheetSave) =>
    apiRequest('/behaviour/sheet', { method: 'PUT', body, schema: BehaviourSheetViewSchema }),
  submit: (body: BehaviourSheetSubmit) =>
    apiRequest('/behaviour/sheet/submit', {
      method: 'POST',
      body,
      schema: BehaviourSheetViewSchema,
    }),
  forStudent: (studentId: string, signal?: Signal) =>
    apiRequest(`/behaviour/students/${studentId}`, {
      schema: StudentBehaviourListSchema,
      ...opts(signal),
    }),
};

export const achievementsApi = {
  options: (academicYearId: string | null, signal?: Signal) =>
    apiRequest(`/achievements/options${year(academicYearId)}`, {
      schema: AchievementOptionsViewSchema,
      ...opts(signal),
    }),
  list: (query: AchievementListQuery, signal?: Signal) =>
    apiRequest(`/achievements${queryString(query)}`, {
      schema: AchievementListSchema,
      ...opts(signal),
    }),
  create: (body: AchievementCreate) =>
    apiRequest('/achievements', { method: 'POST', body, schema: AchievementViewSchema }),
  update: (id: string, body: AchievementUpdate) =>
    apiRequest(`/achievements/${id}`, { method: 'PUT', body, schema: AchievementViewSchema }),
  archive: (id: string) =>
    apiRequest(`/achievements/${id}/archive`, { method: 'POST', schema: AchievementViewSchema }),
  restore: (id: string) =>
    apiRequest(`/achievements/${id}/restore`, { method: 'POST', schema: AchievementViewSchema }),
  remove: (id: string) =>
    apiRequest(`/achievements/${id}`, {
      method: 'DELETE',
      schema: z.object({ deleted: z.boolean() }),
    }),
};
