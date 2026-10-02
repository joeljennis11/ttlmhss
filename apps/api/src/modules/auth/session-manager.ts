import type { AuthConfig } from '../../config/config.js';
import { newId, toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type {
  SessionRecord,
  SessionRevocationReason,
  StoredCredential,
  UserAccount,
} from './auth.repository.js';
import { generateSessionToken, hashSessionToken, isWellFormedSessionToken } from './secrets.js';

export interface SessionMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface IssuedSession {
  /** Raw token for the cookie. Never stored, never logged. */
  token: string;
  session: SessionRecord;
}

export interface ResolvedSession {
  session: SessionRecord;
  account: UserAccount;
  credential: StoredCredential;
}

/** Writes to last_seen_at at most this often per session (sliding idle timeout without a write per request). */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Server-side session lifecycle. A session is valid only while ALL hold:
 *   not revoked · before its absolute expiry · used within the idle timeout ·
 *   the user is ACTIVE · the user still has a credential.
 */
export class SessionManager {
  constructor(
    private readonly config: AuthConfig,
    private readonly clock: Clock,
  ) {}

  async issue(repos: Repositories, userId: string, meta: SessionMeta): Promise<IssuedSession> {
    const now = this.clock.now();
    const token = generateSessionToken();
    const session: SessionRecord = {
      id: newId(),
      userId,
      tokenHash: hashSessionToken(token, this.config.sessionSecret),
      createdAt: toTimestamp(now),
      lastSeenAt: toTimestamp(now),
      expiresAt: toTimestamp(new Date(now.getTime() + this.config.absoluteTimeoutMs)),
      revokedAt: null,
    };
    await repos.sessions.create({
      ...session,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
    });
    return { token, session };
  }

  /** Find the session a raw token refers to, if any (valid or not). */
  async find(repos: Repositories, token: unknown): Promise<SessionRecord | null> {
    if (!isWellFormedSessionToken(token)) return null;
    return repos.sessions.findByTokenHash(hashSessionToken(token, this.config.sessionSecret));
  }

  async resolve(repos: Repositories, token: unknown): Promise<ResolvedSession | null> {
    const session = await this.find(repos, token);
    if (!session || session.revokedAt) return null;

    const now = this.clock.now().getTime();
    if (now >= Date.parse(session.expiresAt)) return null;
    const idleFor = now - Date.parse(session.lastSeenAt);
    if (idleFor >= this.config.idleTimeoutMs) return null;

    const account = await repos.userAccounts.findById(session.userId);
    if (!account || account.status !== 'ACTIVE') return null;
    const credential = await repos.credentials.find(account.id);
    if (!credential) return null;

    if (idleFor >= TOUCH_INTERVAL_MS) {
      const at = toTimestamp(this.clock.now());
      await repos.sessions.touch(session.id, at);
      session.lastSeenAt = at;
    }
    return { session, account, credential };
  }

  revoke(repos: Repositories, sessionId: string, reason: SessionRevocationReason): Promise<void> {
    return repos.sessions.revoke(sessionId, toTimestamp(this.clock.now()), reason);
  }

  revokeAllForUser(
    repos: Repositories,
    userId: string,
    reason: SessionRevocationReason,
    exceptSessionId?: string,
  ): Promise<number> {
    return repos.sessions.revokeAllForUser(
      userId,
      toTimestamp(this.clock.now()),
      reason,
      exceptSessionId,
    );
  }
}
