import type { RecordStatus, UserRole } from '@ttlmhss/shared';
import { UsernameSchema } from '@ttlmhss/shared';
import type { Principal } from '../../core/auth/access.js';
import type { AuthorizationService } from '../../core/auth/authorization.service.js';
import { AuditRecorder } from '../../core/audit/audit-recorder.js';
import { NotFoundError, ValidationError } from '../../core/errors/app-errors.js';
import { newId, toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { DataStore, Repositories } from '../../data/data-store.js';
import type { PasswordHasher } from './password-hasher.js';
import { generateTemporaryPassword } from './secrets.js';
import type { SessionManager } from './session-manager.js';

/** Who is performing an account operation: a signed-in user (checked for permission) or the system CLI. */
export type AccountActor = Principal | 'system';

export interface TemporaryCredential {
  userId: string;
  username: string;
  /** Shown ONCE to the person issuing it. Never stored in plaintext, never logged. */
  temporaryPassword: string;
}

/**
 * Account credential operations needed by later phases (Admin adds a teacher/student → account is
 * created with a temporary password; Admin resets a password; Admin deactivates an account) and
 * by the bootstrap CLI. No HTTP endpoints use this in Phase 2.
 *
 * Every operation is audited. Deactivation and password resets revoke all live sessions.
 */
export class AccountCredentialsService {
  constructor(
    private readonly deps: {
      dataStore: DataStore;
      hasher: PasswordHasher;
      sessions: SessionManager;
      authorization: AuthorizationService;
      clock: Clock;
    },
  ) {}

  private actorId(
    actor: AccountActor,
    permission: Parameters<AuthorizationService['authorize']>[1],
  ) {
    if (actor === 'system') return null;
    return this.deps.authorization.authorize(actor, permission).userId;
  }

  private audit(repos: Repositories) {
    return new AuditRecorder(repos.auditLogs, this.deps.clock);
  }

  /**
   * Create a login with a temporary password. Linking it to a teacher/student profile is done by
   * the caller in the same unit of work (Phase 5); pass `repos` from that transaction.
   */
  async createAccount(
    input: { username: string; role: UserRole },
    actor: AccountActor,
    repos?: Repositories,
  ): Promise<TemporaryCredential> {
    const actorUserId = this.actorId(actor, 'users.create');
    const parsed = UsernameSchema.safeParse(input.username);
    if (!parsed.success) {
      throw new ValidationError([
        { path: 'username', message: parsed.error.issues[0]?.message ?? 'Invalid username' },
      ]);
    }
    const username = parsed.data;
    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.deps.hasher.hash(temporaryPassword);
    const userId = newId();

    const work = async (tx: Repositories) => {
      const now = toTimestamp(this.deps.clock.now());
      await tx.userAccounts.create(
        { id: userId, username, role: input.role, status: 'ACTIVE' },
        now,
      );
      await tx.credentials.save(userId, hash, 'TEMPORARY', now);
      await this.audit(tx).record(
        {
          action: 'account.created',
          entityType: 'user',
          entityId: userId,
          after: { username, role: input.role },
        },
        { actorUserId, requestId: null },
      );
    };
    if (repos) await work(repos);
    else await this.deps.dataStore.transaction(work);

    return { userId, username, temporaryPassword };
  }

  /** Replace the user's password with a new temporary one and sign them out everywhere. */
  async issueTemporaryPassword(userId: string, actor: AccountActor): Promise<TemporaryCredential> {
    const actorUserId = this.actorId(actor, 'users.reset_password');
    const account = await this.deps.dataStore.repositories.userAccounts.findById(userId);
    if (!account) throw new NotFoundError('That user account was not found.');

    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.deps.hasher.hash(temporaryPassword);
    await this.deps.dataStore.transaction(async (tx) => {
      const now = toTimestamp(this.deps.clock.now());
      await tx.credentials.save(userId, hash, 'TEMPORARY', now);
      const revoked = await this.deps.sessions.revokeAllForUser(tx, userId, 'password_reset');
      await this.audit(tx).record(
        {
          action: 'auth.password.temporary_issued',
          entityType: 'user',
          entityId: userId,
          after: { sessionsRevoked: revoked },
        },
        { actorUserId, requestId: null },
      );
    });
    return { userId, username: account.username, temporaryPassword };
  }

  /** Activate or deactivate an account. Deactivation signs the user out immediately. */
  async setStatus(userId: string, status: RecordStatus, actor: AccountActor): Promise<void> {
    const actorUserId = this.actorId(actor, 'users.edit');
    const account = await this.deps.dataStore.repositories.userAccounts.findById(userId);
    if (!account) throw new NotFoundError('That user account was not found.');
    if (account.status === status) return;

    await this.deps.dataStore.transaction(async (tx) => {
      const now = toTimestamp(this.deps.clock.now());
      await tx.userAccounts.setStatus(userId, status, now);
      const revoked =
        status === 'INACTIVE'
          ? await this.deps.sessions.revokeAllForUser(tx, userId, 'account_deactivated')
          : 0;
      await this.audit(tx).record(
        {
          action: status === 'INACTIVE' ? 'account.deactivated' : 'account.activated',
          entityType: 'user',
          entityId: userId,
          before: { status: account.status },
          after: { status, sessionsRevoked: revoked },
        },
        { actorUserId, requestId: null },
      );
    });
  }
}
