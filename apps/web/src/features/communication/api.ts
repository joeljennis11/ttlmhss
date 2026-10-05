import {
  AnnouncementListSchema,
  AnnouncementOptionsViewSchema,
  AnnouncementViewSchema,
  DashboardViewSchema,
  RequestDetailSchema,
  RequestFormOptionsSchema,
  RequestListSchema,
  StudentDayViewSchema,
  type AnnouncementCreate,
  type AnnouncementInput,
  type AnnouncementListQuery,
  type RequestAssign,
  type RequestCreate,
  type RequestListQuery,
  type RequestStatusChange,
} from '@ttlmhss/shared';
import { apiRequest } from '../../lib/api-client';
import { queryString } from '../people/api';

/*
 * Phase 10 API calls: the role dashboard, announcements and structured requests. The server
 * decides scope, audience and visibility; the browser shows what it returns.
 */
type Signal = AbortSignal | undefined;
const opts = (signal: Signal) => (signal ? { signal } : {});

export const dashboardApi = {
  get: (signal?: Signal) =>
    apiRequest('/dashboard', { schema: DashboardViewSchema, ...opts(signal) }),
};

export const announcementsApi = {
  feed: (page: number, pageSize: number, signal?: Signal) =>
    apiRequest(`/announcements/feed${queryString({ page, pageSize })}`, {
      schema: AnnouncementListSchema,
      ...opts(signal),
    }),
  get: (id: string, signal?: Signal) =>
    apiRequest(`/announcements/${id}`, { schema: AnnouncementViewSchema, ...opts(signal) }),
  options: (signal?: Signal) =>
    apiRequest('/announcements/options', {
      schema: AnnouncementOptionsViewSchema,
      ...opts(signal),
    }),
  list: (query: AnnouncementListQuery, signal?: Signal) =>
    apiRequest(`/announcements${queryString(query)}`, {
      schema: AnnouncementListSchema,
      ...opts(signal),
    }),
  create: (body: AnnouncementCreate) =>
    apiRequest('/announcements', { method: 'POST', body, schema: AnnouncementViewSchema }),
  update: (id: string, body: AnnouncementInput) =>
    apiRequest(`/announcements/${id}`, { method: 'PUT', body, schema: AnnouncementViewSchema }),
  publish: (id: string) =>
    apiRequest(`/announcements/${id}/publish`, {
      method: 'POST',
      schema: AnnouncementViewSchema,
    }),
  archive: (id: string) =>
    apiRequest(`/announcements/${id}/archive`, {
      method: 'POST',
      schema: AnnouncementViewSchema,
    }),
  restore: (id: string) =>
    apiRequest(`/announcements/${id}/restore`, {
      method: 'POST',
      schema: AnnouncementViewSchema,
    }),
};

export const requestsApi = {
  mine: (query: RequestListQuery, signal?: Signal) =>
    apiRequest(`/requests/mine${queryString(query)}`, {
      schema: RequestListSchema,
      ...opts(signal),
    }),
  list: (query: RequestListQuery, signal?: Signal) =>
    apiRequest(`/requests${queryString(query)}`, { schema: RequestListSchema, ...opts(signal) }),
  get: (id: string, signal?: Signal) =>
    apiRequest(`/requests/${id}`, { schema: RequestDetailSchema, ...opts(signal) }),
  options: (signal?: Signal) =>
    apiRequest('/requests/options', { schema: RequestFormOptionsSchema, ...opts(signal) }),
  myDay: (date: string, signal?: Signal) =>
    apiRequest(`/attendance/me/day${queryString({ date })}`, {
      schema: StudentDayViewSchema,
      ...opts(signal),
    }),
  create: (body: RequestCreate) =>
    apiRequest('/requests', { method: 'POST', body, schema: RequestDetailSchema }),
  setStatus: (id: string, body: RequestStatusChange) =>
    apiRequest(`/requests/${id}/status`, { method: 'POST', body, schema: RequestDetailSchema }),
  assign: (id: string, body: RequestAssign) =>
    apiRequest(`/requests/${id}/assign`, { method: 'POST', body, schema: RequestDetailSchema }),
};
