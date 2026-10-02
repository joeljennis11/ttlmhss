import { ErrorCode, type FieldIssue } from '@ttlmhss/shared';

/**
 * Typed application errors. Services and repositories throw these; the HTTP error handler maps
 * them to status codes and the standard error envelope. `message` must be safe for end users.
 */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly statusCode: number;
  readonly details?: FieldIssue[];

  constructor(message: string, options?: { details?: FieldIssue[]; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    if (options?.details) this.details = options.details;
  }
}

export class ValidationError extends AppError {
  readonly code = ErrorCode.VALIDATION_ERROR;
  readonly statusCode = 400;
  constructor(details: FieldIssue[], message = 'Some of the submitted information is invalid.') {
    super(message, { details });
  }
}

export class UnauthorizedError extends AppError {
  readonly code = ErrorCode.UNAUTHORIZED;
  readonly statusCode = 401;
  constructor(message = 'You need to sign in to continue.') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = ErrorCode.FORBIDDEN;
  readonly statusCode = 403;
  constructor(message = 'You do not have permission to do this.') {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = ErrorCode.NOT_FOUND;
  readonly statusCode = 404;
  constructor(message = 'The requested item was not found.') {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly code = ErrorCode.CONFLICT;
  readonly statusCode = 409;
  constructor(message = 'This change conflicts with existing data.', cause?: unknown) {
    super(message, { cause });
  }
}

export class ServiceUnavailableError extends AppError {
  readonly code = ErrorCode.SERVICE_UNAVAILABLE;
  readonly statusCode = 503;
  constructor(message = 'The service is temporarily unavailable. Please try again shortly.') {
    super(message);
  }
}

/** Use for invariant violations. The message is logged, never shown to users. */
export class InternalError extends AppError {
  readonly code = ErrorCode.INTERNAL_ERROR;
  readonly statusCode = 500;
}

export const PUBLIC_INTERNAL_ERROR_MESSAGE = 'Something went wrong. Please try again.';
