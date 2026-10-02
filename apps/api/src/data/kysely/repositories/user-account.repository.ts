import { PasswordStatus, RecordStatus, UserRole } from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import { InternalError } from '../../../core/errors/app-errors.js';
import type {
  CredentialRepository,
  NewUserAccount,
  StoredCredential,
  UserAccount,
  UserAccountRepository,
} from '../../../modules/auth/auth.repository.js';
import type { Database } from '../database-schema.js';
import { guard } from '../db-errors.js';

/** Narrow a stored controlled value; a mismatch means corrupted data, not user error. */
function controlled<T extends string>(
  set: { is(value: unknown): value is T },
  value: string,
  field: string,
): T {
  if (!set.is(value)) throw new InternalError(`Unexpected ${field} value in database`);
  return value;
}

export class KyselyUserAccountRepository implements UserAccountRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private query() {
    return this.db
      .selectFrom('users as u')
      .leftJoin('teachers as t', 't.user_id', 'u.id')
      .leftJoin('students as s', 's.user_id', 'u.id')
      .select([
        'u.id',
        'u.username',
        'u.role',
        'u.status',
        't.id as teacher_id',
        't.full_name as teacher_name',
        's.id as student_id',
        's.full_name as student_name',
      ]);
  }

  private map(row: {
    id: string;
    username: string;
    role: string;
    status: string;
    teacher_id: string | null;
    teacher_name: string | null;
    student_id: string | null;
    student_name: string | null;
  }): UserAccount {
    return {
      id: row.id,
      username: row.username,
      role: controlled(UserRole, row.role, 'role'),
      status: controlled(RecordStatus, row.status, 'status'),
      displayName: row.teacher_name ?? row.student_name ?? row.username,
      teacherId: row.teacher_id,
      studentId: row.student_id,
    };
  }

  findByUsername(username: string): Promise<UserAccount | null> {
    return guard(async () => {
      const row = await this.query().where('u.username', '=', username).executeTakeFirst();
      return row ? this.map(row) : null;
    });
  }

  findById(id: string): Promise<UserAccount | null> {
    return guard(async () => {
      const row = await this.query().where('u.id', '=', id).executeTakeFirst();
      return row ? this.map(row) : null;
    });
  }

  create(account: NewUserAccount, now: string): Promise<void> {
    return guard(async () => {
      await this.db
        .insertInto('users')
        .values({ ...account, created_at: now, updated_at: now })
        .execute();
    });
  }

  setStatus(userId: string, status: RecordStatus, now: string): Promise<void> {
    return guard(async () => {
      await this.db
        .updateTable('users')
        .set({ status, updated_at: now })
        .where('id', '=', userId)
        .execute();
    });
  }
}

export class KyselyCredentialRepository implements CredentialRepository {
  constructor(private readonly db: Kysely<Database>) {}

  find(userId: string): Promise<StoredCredential | null> {
    return guard(async () => {
      const row = await this.db
        .selectFrom('user_credentials')
        .selectAll()
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!row) return null;
      return {
        userId: row.user_id,
        passwordHash: row.password_hash,
        passwordStatus: controlled(PasswordStatus, row.password_status, 'password_status'),
        passwordChangedAt: row.password_changed_at,
        lastLoginAt: row.last_login_at,
      };
    });
  }

  save(userId: string, passwordHash: string, status: PasswordStatus, now: string): Promise<void> {
    return guard(async () => {
      const updated = await this.db
        .updateTable('user_credentials')
        .set({
          password_hash: passwordHash,
          password_status: status,
          password_changed_at: now,
          updated_at: now,
        })
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) > 0) return;
      await this.db
        .insertInto('user_credentials')
        .values({
          user_id: userId,
          password_hash: passwordHash,
          password_status: status,
          password_changed_at: now,
          last_login_at: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  recordLogin(userId: string, now: string): Promise<void> {
    return guard(async () => {
      await this.db
        .updateTable('user_credentials')
        .set({ last_login_at: now })
        .where('user_id', '=', userId)
        .execute();
    });
  }
}
