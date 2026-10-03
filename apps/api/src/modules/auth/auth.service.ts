import { passwordPolicyProblems, type AuthUser } from '@ttlmhss/shared';
import type { Principal } from '../../core/auth/access.js';
import { AuditRecorder } from '../../core/audit/audit-recorder.js';
import {
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '../../core/errors/app-errors.js';
import { toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { DataStore, Repositories } from '../../data/data-store.js';
import type { RolePermissionService } from '../../core/auth/role-permissions.js';
import type { LoginThrottle } from './login-throttle.js';
import type { PasswordHasher } from './password-hasher.js';
import { buildPrincipal, toAuthUser } from './principal.js';
import { generateSessionToken } from './secrets.js';
import type { SessionManager } from './session-manager.js';

/** Deliberately identical for every sign-in failure: unknown user, wrong password, inactive account, no password. */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface SignedIn {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export interface AuthServiceDeps {
  dataStore: DataStore;
  hasher: PasswordHasher;
  sessions: SessionManager;
  throttle: LoginThrottle;
  rolePermissions: RolePermissionService;
  clock: Clock;
}

export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * A real hash to verify against when the user does not exist, so failed sign-ins take the same
   * time whether or not the username is valid.
   */
  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(generateSessionToken());
    return this.dummyHash;
  }

  private audit(repos: Repositories) {
    return new AuditRecorder(repos.auditLogs, this.deps.clock);
  }

  async login(input: { username: string; password: string }, meta: RequestMeta): Promise<SignedIn> {
    const { dataStore, hasher, throttle, clock, sessions } = this.deps;
    const repos = dataStore.repositories;
    const throttleKey = `login:${input.username}`;
    const nowMs = clock.now().getTime();

    if (throttle.isLocked(throttleKey, nowMs)) {
      await this.audit(repos).record(
        {
          action: 'auth.login.blocked',
          entityType: 'user',
          entityId: null,
          after: { username: input.username },
        },
        { actorUserId: null, requestId: meta.requestId },
      );
      throw new TooManyRequestsError();
    }

    const account = await repos.userAccounts.findByUsername(input.username);
    const credential = account ? await repos.credentials.find(account.id) : null;
    const passwordOk = await hasher.verify(
      credential?.passwordHash ?? (await this.getDummyHash()),
      input.password,
    );

    if (!account || !credential || !passwordOk || account.status !== 'ACTIVE') {
      throttle.recordFailure(throttleKey, nowMs);
      const reason = !account
        ? 'unknown_user'
        : !credential
          ? 'no_password'
          : !passwordOk
            ? 'wrong_password'
            : 'inactive_account';
      // The reason is recorded for administrators only; the response never reveals it.
      await this.audit(repos).record(
        {
          action: 'auth.login.failed',
          entityType: 'user',
          entityId: account?.id ?? null,
          after: { username: input.username, reason },
        },
        { actorUserId: null, requestId: meta.requestId },
      );
      throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
    }

    throttle.reset(throttleKey);
    const issued = await dataStore.transaction(async (tx) => {
      const now = toTimestamp(clock.now());
      await tx.sessions.pruneForUser(account.id, now);
      const session = await sessions.issue(tx, account.id, meta);
      await tx.credentials.recordLogin(account.id, now);
      await this.audit(tx).record(
        {
          action: 'auth.login.succeeded',
          entityType: 'user',
          entityId: account.id,
          after: { sessionId: session.session.id },
        },
        { actorUserId: account.id, requestId: meta.requestId },
      );
      return session;
    });

    const principal = await buildPrincipal(
      account,
      credential,
      repos.authScope,
      issued.session.id,
      await this.deps.rolePermissions.table(),
    );
    return {
      token: issued.token,
      expiresAt: issued.session.expiresAt,
      user: toAuthUser(principal),
    };
  }

  /** Revokes the session behind the token, if any. Safe to call with no or an invalid token. */
  async logout(token: string | undefined, meta: RequestMeta): Promise<void> {
    const { dataStore, sessions } = this.deps;
    await dataStore.transaction(async (tx) => {
      const session = await sessions.find(tx, token);
      if (!session || session.revokedAt) return;
      await sessions.revoke(tx, session.id, 'logout');
      await this.audit(tx).record(
        {
          action: 'auth.logout',
          entityType: 'user',
          entityId: session.userId,
          after: { sessionId: session.id },
        },
        { actorUserId: session.userId, requestId: meta.requestId },
      );
    });
  }

  me(principal: Principal): AuthUser {
    return toAuthUser(principal);
  }

  /**
   * Change one's own password (also completes the temporary-password flow). Requires the current
   * password. Every session of the user is revoked and a fresh one is issued for this client.
   */
  async changePassword(
    principal: Principal,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<SignedIn> {
    const { dataStore, hasher, throttle, clock, sessions } = this.deps;
    const repos = dataStore.repositories;

    const problems = passwordPolicyProblems(input.newPassword, principal.username);
    if (problems.length > 0) {
      throw new ValidationError(problems.map((message) => ({ path: 'body.newPassword', message })));
    }

    const throttleKey = `password:${principal.userId}`;
    const nowMs = clock.now().getTime();
    if (throttle.isLocked(throttleKey, nowMs)) throw new TooManyRequestsError();

    const credential = await repos.credentials.find(principal.userId);
    if (!credential || !(await hasher.verify(credential.passwordHash, input.currentPassword))) {
      throttle.recordFailure(throttleKey, nowMs);
      await this.audit(repos).record(
        { action: 'auth.password.change_failed', entityType: 'user', entityId: principal.userId },
        { actorUserId: principal.userId, requestId: meta.requestId },
      );
      throw new ValidationError([
        { path: 'body.currentPassword', message: 'Current password is incorrect.' },
      ]);
    }
    throttle.reset(throttleKey);

    const newHash = await hasher.hash(input.newPassword);
    const issued = await dataStore.transaction(async (tx) => {
      const now = toTimestamp(clock.now());
      await tx.credentials.save(principal.userId, newHash, 'SET', now);
      const revoked = await sessions.revokeAllForUser(tx, principal.userId, 'password_changed');
      const session = await sessions.issue(tx, principal.userId, meta);
      await this.audit(tx).record(
        {
          action: 'auth.password.changed',
          entityType: 'user',
          entityId: principal.userId,
          after: { wasTemporary: principal.mustChangePassword, sessionsRevoked: revoked },
        },
        { actorUserId: principal.userId, requestId: meta.requestId },
      );
      return session;
    });

    const account = await repos.userAccounts.findById(principal.userId);
    const updated = await repos.credentials.find(principal.userId);
    if (!account || !updated) throw new UnauthorizedError();
    const refreshed = await buildPrincipal(
      account,
      updated,
      repos.authScope,
      issued.session.id,
      await this.deps.rolePermissions.table(),
    );
    return {
      token: issued.token,
      expiresAt: issued.session.expiresAt,
      user: toAuthUser(refreshed),
    };
  }
}
