import type { PasswordStatus, RecordStatus, UserRole } from '@ttlmhss/shared';

/** A login identity plus the profile it is linked to. Contains no credential data. */
export interface UserAccount {
  id: string;
  username: string;
  role: UserRole;
  status: RecordStatus;
  /** Teacher/student full name when linked, otherwise the username. */
  displayName: string;
  teacherId: string | null;
  studentId: string | null;
}

export interface NewUserAccount {
  id: string;
  username: string;
  role: UserRole;
  status: RecordStatus;
}

export interface UserAccountRepository {
  findByUsername(username: string): Promise<UserAccount | null>;
  findById(id: string): Promise<UserAccount | null>;
  /** Phase 10: active accounts of one role (e.g. administrators a request may be assigned to). */
  listActiveByRole(role: UserRole): Promise<UserAccount[]>;
  create(account: NewUserAccount, now: string): Promise<void>;
  setStatus(userId: string, status: RecordStatus, now: string): Promise<void>;
}

/** Password hash and its state. Only the auth module reads this; it never leaves the API. */
export interface StoredCredential {
  userId: string;
  passwordHash: string;
  passwordStatus: PasswordStatus;
  passwordChangedAt: string;
  lastLoginAt: string | null;
}

export interface CredentialRepository {
  find(userId: string): Promise<StoredCredential | null>;
  /** Create or replace the user's password. */
  save(userId: string, passwordHash: string, status: PasswordStatus, now: string): Promise<void>;
  recordLogin(userId: string, now: string): Promise<void>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface NewSession extends Omit<SessionRecord, 'revokedAt'> {
  ipAddress: string | null;
  userAgent: string | null;
}

export type SessionRevocationReason =
  'logout' | 'password_changed' | 'password_reset' | 'account_deactivated' | 'rotated';

export interface SessionRepository {
  create(session: NewSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touch(sessionId: string, at: string): Promise<void>;
  revoke(sessionId: string, at: string, reason: SessionRevocationReason): Promise<void>;
  /** Revoke every live session of a user (optionally keeping one). Returns how many. */
  revokeAllForUser(
    userId: string,
    at: string,
    reason: SessionRevocationReason,
    exceptSessionId?: string,
  ): Promise<number>;
  /** Delete the user's expired or revoked sessions (housekeeping; events stay in the audit log). */
  pruneForUser(userId: string, now: string): Promise<void>;
}
