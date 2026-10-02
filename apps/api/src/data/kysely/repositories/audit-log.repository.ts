import type { Kysely } from 'kysely';
import type {
  AuditLogRecord,
  AuditLogRepository,
} from '../../../core/audit/audit-log.repository.js';
import type { AuditLogsTable, Database } from '../database-schema.js';
import { guard } from '../db-errors.js';

const toJson = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);
const fromJson = (value: string | null): unknown => (value === null ? null : JSON.parse(value));

function toRecord(row: AuditLogsTable): AuditLogRecord {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    before: fromJson(row.before_json),
    after: fromJson(row.after_json),
    reason: row.reason,
    requestId: row.request_id,
  };
}

/** Append-only: there are deliberately no update or delete methods. */
export class KyselyAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Kysely<Database>) {}

  append(record: AuditLogRecord): Promise<void> {
    return guard(async () => {
      await this.db
        .insertInto('audit_logs')
        .values({
          id: record.id,
          occurred_at: record.occurredAt,
          actor_user_id: record.actorUserId,
          action: record.action,
          entity_type: record.entityType,
          entity_id: record.entityId,
          before_json: toJson(record.before),
          after_json: toJson(record.after),
          reason: record.reason,
          request_id: record.requestId,
        })
        .execute();
    });
  }

  listForEntity(entityType: string, entityId: string, limit: number): Promise<AuditLogRecord[]> {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_type', '=', entityType)
        .where('entity_id', '=', entityId)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute();
      return rows.map(toRecord);
    });
  }
}
