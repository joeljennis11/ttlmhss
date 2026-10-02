import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode, toFieldIssues, type ApiErrorBody } from '@ttlmhss/shared';
import { ZodError } from 'zod';
import { AppError, InternalError, PUBLIC_INTERNAL_ERROR_MESSAGE } from './app-errors.js';

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  error: ApiErrorBody['error'],
) {
  const body: ApiErrorBody = { error: { ...error, requestId: request.id } };
  return reply.status(status).send(body);
}

function isFastifyClientError(error: unknown): error is FastifyError & { statusCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number' &&
    (error as { statusCode: number }).statusCode >= 400 &&
    (error as { statusCode: number }).statusCode < 500
  );
}

/**
 * Single place where errors become HTTP responses.
 *
 * - AppError subclasses → their status/code; message is user-safe.
 * - ZodError escaping a service → 400 VALIDATION_ERROR.
 * - Fastify client errors (malformed JSON, payload too large, …) → 4xx with a generic message.
 * - Anything else → 500 with a generic message; full details go to the log only.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    send(reply, request, 404, {
      code: ErrorCode.NOT_FOUND,
      message: 'The requested resource does not exist.',
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError && !(error instanceof InternalError)) {
      if (error.statusCode >= 500) request.log.error({ err: error }, 'request failed');
      return send(reply, request, error.statusCode, {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    if (error instanceof ZodError) {
      return send(reply, request, 400, {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Some of the submitted information is invalid.',
        details: toFieldIssues(error),
      });
    }

    if (isFastifyClientError(error)) {
      request.log.info({ err: error }, 'client error');
      const status = error.statusCode;
      const code =
        status === 401
          ? ErrorCode.UNAUTHORIZED
          : status === 403
            ? ErrorCode.FORBIDDEN
            : status === 404
              ? ErrorCode.NOT_FOUND
              : ErrorCode.VALIDATION_ERROR;
      return send(reply, request, status, {
        code,
        message:
          status === 413 ? 'The request is too large.' : 'The request could not be processed.',
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return send(reply, request, 500, {
      code: ErrorCode.INTERNAL_ERROR,
      message: PUBLIC_INTERNAL_ERROR_MESSAGE,
    });
  });
}
