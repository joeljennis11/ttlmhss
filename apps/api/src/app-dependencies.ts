import type { AppConfig } from './config/config.js';
import type { AccessPolicy, Authenticator } from './core/auth/access.js';
import type { AuthorizationService } from './core/auth/authorization.service.js';
import type { Clock } from './core/utils/clock.js';
import type { DataStore } from './data/data-store.js';
import type { LoginThrottle } from './modules/auth/login-throttle.js';
import type { PasswordHasher } from './modules/auth/password-hasher.js';
import type { SessionManager } from './modules/auth/session-manager.js';

/**
 * Everything the application needs from the outside world. Built by createAppDependencies()
 * (src/composition.ts); tests substitute any part of it.
 */
export interface AppDependencies {
  config: AppConfig;
  dataStore: DataStore;
  clock: Clock;
  // Phase 2 — security
  passwordHasher: PasswordHasher;
  sessions: SessionManager;
  loginThrottle: LoginThrottle;
  authenticator: Authenticator;
  accessPolicy: AccessPolicy;
  /** Record-level authorization (permission + scope) for feature services. */
  authorization: AuthorizationService;
}
