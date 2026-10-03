import type { Permission } from '@ttlmhss/shared';
import type { Principal } from '../../core/auth/access.js';
import type { AuthorizationService } from '../../core/auth/authorization.service.js';
import { AuditRecorder, type AuditEvent } from '../../core/audit/audit-recorder.js';
import { NotFoundError } from '../../core/errors/app-errors.js';
import { toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { DataStore, Repositories } from '../../data/data-store.js';

/** Who is asking, and the request id for the audit trail. */
export interface RequestContext {
  principal: Principal | null;
  requestId: string | null;
}

export interface ConfigServiceDeps {
  dataStore: DataStore;
  clock: Clock;
  authorization: AuthorizationService;
}

/** Inside a configuration write: transactional repositories, timestamp and an audit writer. */
export interface WriteScope {
  repos: Repositories;
  now: string;
  audit(event: AuditEvent): Promise<void>;
}

/**
 * Shared behaviour of every configuration service:
 * - every method starts with `authorize` (signed in, password set, holds `config.manage` — or the
 *   permission given), so services stay safe even if called from somewhere other than their route;
 * - every change runs in ONE transaction together with its audit entry.
 */
export abstract class ConfigService {
  protected readonly permission: Permission = 'config.manage';

  constructor(protected readonly deps: ConfigServiceDeps) {}

  protected get repos(): Repositories {
    return this.deps.dataStore.repositories;
  }

  protected authorize(ctx: RequestContext): Principal {
    return this.deps.authorization.authorize(ctx.principal, this.permission);
  }

  protected now(): string {
    return toTimestamp(this.deps.clock.now());
  }

  protected async write<T>(
    ctx: RequestContext,
    work: (scope: WriteScope) => Promise<T>,
  ): Promise<T> {
    const actor = this.authorize(ctx);
    return this.deps.dataStore.transaction(async (repos) => {
      const recorder = new AuditRecorder(repos.auditLogs, this.deps.clock);
      return work({
        repos,
        now: this.now(),
        audit: async (event) => {
          await recorder.record(event, { actorUserId: actor.userId, requestId: ctx.requestId });
        },
      });
    });
  }
}

export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new NotFoundError(`That ${what} was not found.`);
  return value;
}

/** Percent ⇄ hundredths of a percent (exact integers in storage). */
export const toBp = (percent: number): number => Math.round(percent * 100);
export const fromBp = (bp: number): number => bp / 100;

/** Keep only the keys whose value is not undefined (PATCH semantics). */
export function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
