import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from '../../config/config.js';

/**
 * Session cookie policy.
 * - HttpOnly: unreadable by JavaScript (XSS cannot steal it).
 * - Secure in production; the `__Host-` prefix then also pins it to this host and path "/".
 * - SameSite=Lax: not sent on cross-site POST/PUT/DELETE requests (CSRF defence, together with
 *   the Origin check and JSON-only bodies).
 * - Expires at the session's absolute expiry; the server also enforces the idle timeout.
 */
export function sessionCookieName(config: AuthConfig): string {
  return config.cookieSecure ? '__Host-ttlmhss_session' : 'ttlmhss_session';
}

function baseOptions(config: AuthConfig) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  config: AuthConfig,
  token: string,
  expiresAt: string,
): void {
  reply.setCookie(sessionCookieName(config), token, {
    ...baseOptions(config),
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AuthConfig): void {
  reply.clearCookie(sessionCookieName(config), baseOptions(config));
}

export function readSessionCookie(request: FastifyRequest, config: AuthConfig): string | undefined {
  return request.cookies[sessionCookieName(config)];
}
