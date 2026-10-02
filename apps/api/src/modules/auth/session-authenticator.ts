import type { FastifyRequest } from 'fastify';
import type { AuthConfig } from '../../config/config.js';
import type { Authenticator, Principal } from '../../core/auth/access.js';
import type { DataStore } from '../../data/data-store.js';
import { buildPrincipal } from './principal.js';
import { readSessionCookie } from './session-cookie.js';
import type { SessionManager } from './session-manager.js';

/** Authenticator for cookie sessions: cookie → valid session → active user → principal. */
export class SessionAuthenticator implements Authenticator {
  constructor(
    private readonly config: AuthConfig,
    private readonly dataStore: DataStore,
    private readonly sessions: SessionManager,
  ) {}

  async authenticate(request: FastifyRequest): Promise<Principal | null> {
    const token = readSessionCookie(request, this.config);
    if (!token) return null;
    const repos = this.dataStore.repositories;
    const resolved = await this.sessions.resolve(repos, token);
    if (!resolved) return null;
    return buildPrincipal(
      resolved.account,
      resolved.credential,
      repos.authScope,
      resolved.session.id,
    );
  }
}
