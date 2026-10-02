import {
  AppError,
  ConflictError,
  InternalError,
  ServiceUnavailableError,
} from '../../core/errors/app-errors.js';

/**
 * Translate driver-specific errors into application errors so services never see SQLite or
 * PostgreSQL error codes. Constraint violations that validation should have caught (CHECK,
 * NOT NULL) are treated as internal errors: they indicate a bug, not bad user input.
 */
type Kind = 'unique' | 'foreign_key' | 'integrity' | 'unavailable' | 'unknown';

const SQLITE_KIND: Record<string, Kind> = {
  SQLITE_CONSTRAINT_UNIQUE: 'unique',
  SQLITE_CONSTRAINT_PRIMARYKEY: 'unique',
  SQLITE_CONSTRAINT_FOREIGNKEY: 'foreign_key',
  // SQLite reports ON DELETE/UPDATE RESTRICT violations with this code. The schema defines no
  // triggers, so it can only mean a restricted foreign-key action.
  SQLITE_CONSTRAINT_TRIGGER: 'foreign_key',
  SQLITE_CONSTRAINT_CHECK: 'integrity',
  SQLITE_CONSTRAINT_NOTNULL: 'integrity',
  SQLITE_CANTOPEN: 'unavailable',
  SQLITE_BUSY: 'unavailable',
};

const POSTGRES_KIND: Record<string, Kind> = {
  '23505': 'unique',
  '23503': 'foreign_key',
  '23001': 'foreign_key', // restrict_violation (ON DELETE RESTRICT)
  '23514': 'integrity',
  '23502': 'integrity',
  '57P01': 'unavailable',
  '53300': 'unavailable',
};

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']);

export function classifyDbError(error: unknown): Kind {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return 'unknown';
  return (
    SQLITE_KIND[code] ??
    POSTGRES_KIND[code] ??
    (NETWORK_CODES.has(code) ? 'unavailable' : 'unknown')
  );
}

export function translateDbError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  switch (classifyDbError(error)) {
    case 'unique':
      return new ConflictError('A record with the same unique value already exists.', error);
    case 'foreign_key':
      return new ConflictError(
        'This change would break a link to other records (for example, history that depends on it).',
        error,
      );
    case 'integrity':
      return new InternalError('Database integrity constraint rejected the write', {
        cause: error,
      });
    case 'unavailable':
      return new ServiceUnavailableError();
    default:
      return error;
  }
}

/** Run a database operation and translate any failure. */
export async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translateDbError(error);
  }
}
