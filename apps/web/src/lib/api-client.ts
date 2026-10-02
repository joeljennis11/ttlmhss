import { API_PREFIX, type ApiErrorBody, type ApiSuccess, type FieldIssue } from '@ttlmhss/shared';
import type { z } from 'zod';

/**
 * The web app's ONLY way to reach data: HTTP calls to the API. Components never hold business
 * rules; they render what the API returns and surface its errors.
 */
export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: FieldIssue[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const NETWORK_ERROR = 'NETWORK_ERROR';
export const INVALID_RESPONSE = 'INVALID_RESPONSE';

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.message === 'string'
  );
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Validate the `data` payload; recommended for every call. */
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
}

/**
 * Call the API and return `data`. Errors become ApiClientError with a user-safe message.
 * A non-2xx response that still carries a `data` payload (e.g. health reporting 503 "degraded")
 * returns that payload so the caller can show it.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions<T> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${API_PREFIX}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(NETWORK_ERROR, 'Cannot reach the server. Check your connection.', 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      INVALID_RESPONSE,
      'The server sent an unexpected response.',
      response.status,
    );
  }

  if (!response.ok || isErrorBody(payload)) {
    if (isErrorBody(payload)) {
      const { code, message, details, requestId } = payload.error;
      throw new ApiClientError(code, message, response.status, details ?? [], requestId);
    }
    // Some endpoints (health) carry a meaningful data payload with a non-2xx status.
    if (!(payload && typeof payload === 'object' && 'data' in payload)) {
      throw new ApiClientError(
        INVALID_RESPONSE,
        'The server sent an unexpected response.',
        response.status,
      );
    }
  }

  const data = (payload as ApiSuccess<unknown>).data;
  if (options.schema) {
    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiClientError(
        INVALID_RESPONSE,
        'The server sent an unexpected response.',
        response.status,
      );
    }
    return parsed.data;
  }
  return data as T;
}
