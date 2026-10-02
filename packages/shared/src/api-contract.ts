import { z } from 'zod';
import type { FieldIssue } from './validation.js';

/**
 * HTTP contract between the web app and the API.
 *
 * Success:  { "data": <payload>, "meta"?: { ...pagination } }
 * Failure:  { "error": { "code", "message", "details"?, "requestId"? } }
 *
 * `message` is always safe to show to a user. Internal error details never leave the server.
 */
export const API_PREFIX = '/api/v1';

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: FieldIssue[];
    requestId?: string;
  };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: PageMeta;
}

// ---------------------------------------------------------------------------
// Foundation endpoints (Phase 1). Feature DTOs are added in their own phases.
// ---------------------------------------------------------------------------

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Public, non-sensitive school identity used by the web shell and (later) the login page and PDFs. */
export const SchoolBrandingSchema = z.object({
  shortName: z.string(),
  fullName: z.string(),
  primaryColor: z.string(),
  /** Null until the official logo is supplied by the school. Never substituted with a placeholder. */
  logoUrl: z.string().nullable(),
});
export type SchoolBranding = z.infer<typeof SchoolBrandingSchema>;
