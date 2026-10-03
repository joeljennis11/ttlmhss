import { newId, toTimestamp, type Clock } from '../utils/clock.js';
import type { AuditLogRecord, AuditLogRepository } from './audit-log.repository.js';

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export interface AuditContext {
  actorUserId: string | null;
  requestId: string | null;
}

// `pass` alone or any key mentioning a password; NOT e.g. `passMarks`/`passed` (exam data).
const SENSITIVE_KEY = /^pass$|password|passphrase|secret|token|hash/i;
const REDACTED = '[REDACTED]';

/** Deep copy with sensitive keys masked. Audit data must never contain credentials. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(inner),
      ]),
    );
  }
  return value;
}

/**
 * Writes audit entries. Construct it with the repository of the current unit of work so the
 * audit entry commits or rolls back together with the change it describes.
 */
export class AuditRecorder {
  constructor(
    private readonly repository: AuditLogRepository,
    private readonly clock: Clock,
  ) {}

  async record(event: AuditEvent, context: AuditContext): Promise<AuditLogRecord> {
    const record: AuditLogRecord = {
      id: newId(),
      occurredAt: toTimestamp(this.clock.now()),
      actorUserId: context.actorUserId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: redactSensitive(event.before ?? null),
      after: redactSensitive(event.after ?? null),
      reason: event.reason ?? null,
      requestId: context.requestId,
    };
    await this.repository.append(record);
    return record;
  }
}
