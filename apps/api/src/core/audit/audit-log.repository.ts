/**
 * Append-only audit trail for privileged and history-sensitive changes
 * (attendance changes and overrides, marks unlock/corrections, promotions, configuration and
 * permission changes, account administration). Individual events are added by their phases.
 */
export interface AuditLogRecord {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  /** `resource.verb`, e.g. `attendance.override`. */
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
}

export interface AuditLogRepository {
  append(record: AuditLogRecord): Promise<void>;
  listForEntity(entityType: string, entityId: string, limit: number): Promise<AuditLogRecord[]>;
}
