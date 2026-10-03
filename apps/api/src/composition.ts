import type { AppDependencies } from './app-dependencies.js';
import type { AppConfig } from './config/config.js';
import { permissionPolicy } from './core/auth/access.js';
import { AuthorizationService } from './core/auth/authorization.service.js';
import { RolePermissionService } from './core/auth/role-permissions.js';
import { systemClock, type Clock } from './core/utils/clock.js';
import type { DataStore } from './data/data-store.js';
import { AccountCredentialsService } from './modules/auth/account-credentials.service.js';
import { LoginThrottle } from './modules/auth/login-throttle.js';
import { Argon2PasswordHasher } from './modules/auth/password-hasher.js';
import { SessionAuthenticator } from './modules/auth/session-authenticator.js';
import { SessionManager } from './modules/auth/session-manager.js';

/** Wire the production implementations. Any dependency can be overridden (tests). */
export function createAppDependencies(
  config: AppConfig,
  dataStore: DataStore,
  overrides: Partial<Omit<AppDependencies, 'config' | 'dataStore'>> = {},
): AppDependencies {
  const clock: Clock = overrides.clock ?? systemClock;
  const sessions = overrides.sessions ?? new SessionManager(config.auth, clock);
  const rolePermissions =
    overrides.rolePermissions ??
    new RolePermissionService(() => dataStore.repositories.rolePermissions.list());
  return {
    config,
    dataStore,
    clock,
    passwordHasher: overrides.passwordHasher ?? new Argon2PasswordHasher(),
    sessions,
    loginThrottle:
      overrides.loginThrottle ??
      new LoginThrottle({
        maxFailures: config.auth.maxFailedAttempts,
        lockoutMs: config.auth.lockoutMs,
      }),
    authenticator:
      overrides.authenticator ??
      new SessionAuthenticator(config.auth, dataStore, sessions, rolePermissions),
    rolePermissions,
    accessPolicy: overrides.accessPolicy ?? permissionPolicy,
    authorization:
      overrides.authorization ?? new AuthorizationService(dataStore.repositories.authScope),
  };
}

/** Account operations for the CLI and later Admin phases. */
export function createAccountCredentialsService(deps: AppDependencies): AccountCredentialsService {
  return new AccountCredentialsService({
    dataStore: deps.dataStore,
    hasher: deps.passwordHasher,
    sessions: deps.sessions,
    authorization: deps.authorization,
    clock: deps.clock,
  });
}
