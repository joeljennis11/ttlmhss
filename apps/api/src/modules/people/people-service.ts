import type { Permission, PlacementView, AccountStatusView } from '@ttlmhss/shared';
import type { Principal } from '../../core/auth/access.js';
import type { AuthorizationService } from '../../core/auth/authorization.service.js';
import { AuditRecorder, type AuditEvent } from '../../core/audit/audit-recorder.js';
import { NotFoundError, fieldConflict } from '../../core/errors/app-errors.js';
import { toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { DataStore, Repositories } from '../../data/data-store.js';
import type { AccountCredentialsService } from '../auth/account-credentials.service.js';
import type { SessionManager } from '../auth/session-manager.js';
import type { AcademicYearRecord, SectionRecord } from '../config/config.repository.js';
import type { LinkedAccount, PlacementRecord } from './people.repository.js';

/** Calendar dates ("today") are taken in the school's time zone (Tamil Nadu, India). */
export const SCHOOL_TIME_ZONE = 'Asia/Kolkata';

export interface RequestContext {
  principal: Principal | null;
  requestId: string | null;
}

export interface PeopleServiceDeps {
  dataStore: DataStore;
  clock: Clock;
  authorization: AuthorizationService;
  accounts: AccountCredentialsService;
  sessions: SessionManager;
}

export interface WriteScope {
  repos: Repositories;
  now: string;
  actor: Principal;
  audit(event: AuditEvent): Promise<void>;
}

/**
 * Base of the Phase 5 services. Every method authorizes first (signed in, password set, holding
 * the permission). Every change runs in ONE transaction together with its audit entries, so a
 * failure part-way (e.g. the fifth student of a promotion) leaves nothing half-done.
 */
export abstract class PeopleService {
  constructor(protected readonly deps: PeopleServiceDeps) {}

  protected get repos(): Repositories {
    return this.deps.dataStore.repositories;
  }

  protected authorize(ctx: RequestContext, permission: Permission): Principal {
    return this.deps.authorization.authorize(ctx.principal, permission);
  }

  protected today(): string {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: SCHOOL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.deps.clock.now());
  }

  protected async write<T>(
    ctx: RequestContext,
    permission: Permission,
    work: (scope: WriteScope) => Promise<T>,
  ): Promise<T> {
    const actor = this.authorize(ctx, permission);
    return this.deps.dataStore.transaction(async (repos) => {
      const recorder = new AuditRecorder(repos.auditLogs, this.deps.clock);
      return work({
        repos,
        actor,
        now: toTimestamp(this.deps.clock.now()),
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

export function toPlacementView(p: PlacementRecord): PlacementView {
  return {
    enrolmentId: p.enrolmentId,
    academicYearId: p.academicYearId,
    academicYearLabel: p.academicYearLabel,
    classId: p.classId,
    className: p.className,
    sectionId: p.sectionId,
    sectionName: p.sectionName,
    rollNumber: p.rollNumber,
    status: p.status,
    startedOn: p.startedOn,
    endedOn: p.endedOn,
  };
}

export function toAccountView(a: LinkedAccount | null): AccountStatusView | null {
  return a
    ? {
        userId: a.userId,
        username: a.username,
        status: a.status,
        mustChangePassword: a.mustChangePassword,
        lastLoginAt: a.lastLoginAt,
      }
    : null;
}

/** A year new placements may be made in (not a closed, historical year). */
export async function openYear(
  repos: Repositories,
  id: string,
  field: string,
): Promise<AcademicYearRecord> {
  const year = required(await repos.academicYears.find(id), 'academic year');
  if (year.status === 'CLOSED') {
    throw fieldConflict(
      field,
      `${year.label} is closed. Students can only be placed in a current or upcoming year.`,
    );
  }
  return year;
}

/** An active section of an active class, with names for messages. */
export async function usableSection(
  repos: Repositories,
  id: string,
  field: string,
): Promise<SectionRecord & { className: string; label: string }> {
  const section = await repos.classes.findSection(id);
  if (!section) throw fieldConflict(field, 'That class and section was not found.');
  const cls = required(await repos.classes.findClass(section.classId), 'class');
  const label = `${cls.name} ${section.name}`;
  if (cls.status !== 'ACTIVE' || section.status !== 'ACTIVE') {
    throw fieldConflict(field, `${label} is inactive. Choose an active class and section.`);
  }
  return { ...section, className: cls.name, label };
}

export async function checkRollNumber(
  repos: Repositories,
  yearId: string,
  sectionId: string,
  rollNumber: string | null,
  field: string,
  label: string,
) {
  if (rollNumber && (await repos.enrolments.rollNumberTaken(yearId, sectionId, rollNumber))) {
    throw fieldConflict(field, `Roll number ${rollNumber} is already used in ${label}.`);
  }
}

export function dateWithin(date: string, year: AcademicYearRecord, field: string) {
  if (date < year.startDate || date > year.endDate) {
    throw fieldConflict(
      field,
      `The date must fall within ${year.label} (${year.startDate} to ${year.endDate}).`,
    );
  }
}
