import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../errors/app-errors.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence for cookie-authenticated, state-changing requests (in addition to SameSite=Lax
 * cookies and JSON-only request bodies):
 * - if the browser says where the request came from (Origin), it must be an allowed web origin
 *   or this server itself;
 * - requests a browser marks as cross-site (Sec-Fetch-Site) are refused.
 * Non-browser clients (no Origin / Sec-Fetch headers) are unaffected; they cannot ride a
 * victim's browser cookies anyway.
 */
export function registerOriginCheck(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins);

  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (origin !== undefined) {
      const self = `${request.protocol}://${request.host}`;
      if (origin !== self && !allowed.has(origin)) {
        throw new ForbiddenError('This request was blocked because it came from another site.');
      }
      return;
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      throw new ForbiddenError('This request was blocked because it came from another site.');
    }
  });
}
