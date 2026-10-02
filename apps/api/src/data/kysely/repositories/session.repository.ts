import type { Kysely } from 'kysely';
import type {
  NewSession,
  SessionRecord,
  SessionRepository,
  SessionRevocationReason,
} from '../../../modules/auth/auth.repository.js';
import type { Database, SessionsTable } from '../database-schema.js';
import { guard } from '../db-errors.js';

function toRecord(row: SessionsTable): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class KyselySessionRepository implements SessionRepository {
  constructor(private readonly db: Kysely<Database>) {}

  create(session: NewSession): Promise<void> {
    return guard(async () => {
      await this.db
        .insertInto('sessions')
        .values({
          id: session.id,
          token_hash: session.tokenHash,
          user_id: session.userId,
          created_at: session.createdAt,
          last_seen_at: session.lastSeenAt,
          expires_at: session.expiresAt,
          revoked_at: null,
          revoked_reason: null,
          ip_address: session.ipAddress,
          user_agent: session.userAgent,
        })
        .execute();
    });
  }

  findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return guard(async () => {
      const row = await this.db
        .selectFrom('sessions')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row ? toRecord(row) : null;
    });
  }

  touch(sessionId: string, at: string): Promise<void> {
    return guard(async () => {
      await this.db
        .updateTable('sessions')
        .set({ last_seen_at: at })
        .where('id', '=', sessionId)
        .execute();
    });
  }

  revoke(sessionId: string, at: string, reason: SessionRevocationReason): Promise<void> {
    return guard(async () => {
      await this.db
        .updateTable('sessions')
        .set({ revoked_at: at, revoked_reason: reason })
        .where('id', '=', sessionId)
        .where('revoked_at', 'is', null)
        .execute();
    });
  }

  revokeAllForUser(
    userId: string,
    at: string,
    reason: SessionRevocationReason,
    exceptSessionId?: string,
  ): Promise<number> {
    return guard(async () => {
      let query = this.db
        .updateTable('sessions')
        .set({ revoked_at: at, revoked_reason: reason })
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null);
      if (exceptSessionId) query = query.where('id', '!=', exceptSessionId);
      const result = await query.executeTakeFirst();
      return Number(result.numUpdatedRows);
    });
  }

  pruneForUser(userId: string, now: string): Promise<void> {
    return guard(async () => {
      await this.db
        .deleteFrom('sessions')
        .where('user_id', '=', userId)
        .where((eb) => eb.or([eb('expires_at', '<=', now), eb('revoked_at', 'is not', null)]))
        .execute();
    });
  }
}
