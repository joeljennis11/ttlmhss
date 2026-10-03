import {
  Weekday,
  type Permission,
  type TimetableEntryView,
  type TimetablePeriodView,
  type TimetableSectionRef,
  type TimetableVersionView,
} from '@ttlmhss/shared';
import { AuditRecorder, type AuditEvent } from '../../core/audit/audit-recorder.js';
import type { Principal } from '../../core/auth/access.js';
import type { AuthorizationService } from '../../core/auth/authorization.service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors/app-errors.js';
import { toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { DataStore, Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord, PeriodRecord } from '../config/config.repository.js';
import type { TimetableEntryRecord, TimetableVersionRecord } from './timetable.repository.js';

export interface RequestContext {
  principal: Principal | null;
  requestId: string | null;
}

export interface TimetableServiceDeps {
  dataStore: DataStore;
  clock: Clock;
  authorization: AuthorizationService;
}

export interface WriteScope {
  repos: Repositories;
  now: string;
  actor: Principal;
  audit(event: AuditEvent): Promise<void>;
}

/** Thrown inside a transaction to roll back a validate-only ("dry run") batch. */
export class RollbackWith<T> extends Error {
  constructor(readonly result: T) {
    super('dry run');
  }
}

/**
 * Base of the timetable services: authorize first, then do every change in ONE transaction with
 * its audit entries (BR-TT-07: a batch of edits or a publish either fully happens or not at all).
 */
export abstract class TimetableServiceBase {
  constructor(protected readonly deps: TimetableServiceDeps) {}

  protected get repos(): Repositories {
    return this.deps.dataStore.repositories;
  }

  protected authorize(ctx: RequestContext, permission: Permission): Principal {
    return this.deps.authorization.authorize(ctx.principal, permission);
  }

  protected isAdmin(principal: Principal): boolean {
    return this.deps.authorization.isAdmin(principal);
  }

  /**
   * Editing scope (D-17): an administrator edits every section; anyone else holding
   * `timetable.manage` (only Class Teachers can) edits only the sections they are class teacher of.
   */
  protected canManageSection(principal: Principal, sectionId: string): boolean {
    return (
      this.isAdmin(principal) || this.deps.authorization.isClassTeacherOf(principal, sectionId)
    );
  }

  protected checkManageSection(principal: Principal, sectionId: string, label?: string): void {
    if (!this.canManageSection(principal, sectionId)) {
      throw new ForbiddenError(
        label
          ? `You can only change the timetable of your own class. ${label} is not your class.`
          : 'You can only change the timetable of your own class.',
      );
    }
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

  /** The year asked for, or the CURRENT year when none is given. */
  protected async yearOrCurrent(repos: Repositories, id?: string): Promise<AcademicYearRecord> {
    if (id) return required(await repos.academicYears.find(id), 'academic year');
    const current = await repos.academicYears.findCurrent();
    if (!current) throw new ConflictError('There is no current academic year.');
    return current;
  }
}

export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new NotFoundError(`That ${what} was not found.`);
  return value;
}

// ---- The week frame (configured days × periods) ---------------------------------------------------

export interface WeekFrame {
  year: AcademicYearRecord;
  /** Working days of the year, in week order (empty when not configured). */
  workingDays: Weekday[];
  /** All slots of the year's day, in day order (breaks and inactive ones included). */
  slots: PeriodRecord[];
  slotById: Map<string, PeriodRecord>;
}

export async function loadFrame(repos: Repositories, year: AcademicYearRecord): Promise<WeekFrame> {
  const slots = await repos.periods.listByYear(year.id);
  return {
    year,
    workingDays: sortDays(year.workingDays ?? []),
    slots,
    slotById: new Map(slots.map((s) => [s.id, s])),
  };
}

export const dayIndex = (day: Weekday) => Weekday.values.indexOf(day);
export const sortDays = (days: readonly Weekday[]) =>
  [...new Set(days)].sort((a, b) => dayIndex(a) - dayIndex(b));

export const DAY_NAMES: Record<Weekday, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

/**
 * What the grid shows: the year's working days and ACTIVE slots, plus any day or slot that a shown
 * entry still uses after the configuration changed (so nothing silently disappears; the slot comes
 * back with its INACTIVE status and the draft lists it as a problem).
 */
export function gridFor(frame: WeekFrame, entries: readonly TimetableEntryRecord[]) {
  const usedSlots = new Set(entries.map((e) => e.periodId));
  const periods = frame.slots
    .filter((s) => s.status === 'ACTIVE' || usedSlots.has(s.id))
    .map(toPeriodView);
  const workingDays = sortDays([...frame.workingDays, ...entries.map((e) => e.day)]);
  return {
    academicYear: { id: frame.year.id, label: frame.year.label, status: frame.year.status },
    workingDays,
    periods,
  };
}

/** Entries in week order: day, then the slot's position in the school day, then class. */
export function sortEntries(frame: WeekFrame, entries: TimetableEntryRecord[]) {
  const position = new Map(frame.slots.map((s, i) => [s.id, i]));
  return [...entries].sort(
    (a, b) =>
      dayIndex(a.day) - dayIndex(b.day) ||
      (position.get(a.periodId) ?? 999) - (position.get(b.periodId) ?? 999) ||
      a.className.localeCompare(b.className) ||
      a.sectionName.localeCompare(b.sectionName),
  );
}

export function toPeriodView(p: PeriodRecord): TimetablePeriodView {
  return {
    id: p.id,
    kind: p.kind,
    periodNumber: p.periodNumber,
    label: p.label,
    startTime: p.startTime,
    endTime: p.endTime,
    status: p.status,
  };
}

export function toEntryView(e: TimetableEntryRecord): TimetableEntryView {
  return {
    id: e.id,
    day: e.day,
    periodId: e.periodId,
    classId: e.classId,
    className: e.className,
    sectionId: e.sectionId,
    sectionName: e.sectionName,
    subjectId: e.subjectId,
    subjectName: e.subjectName,
    subjectCode: e.subjectCode,
    teacherId: e.teacherId,
    teacherName: e.teacherName,
    staffCode: e.staffCode,
  };
}

export function toVersionView(v: TimetableVersionRecord): TimetableVersionView {
  return {
    id: v.id,
    academicYearId: v.academicYearId,
    versionNumber: v.versionNumber,
    status: v.status,
    entryCount: v.entryCount,
    createdAt: v.createdAt,
    createdBy: v.createdByName,
    updatedAt: v.updatedAt,
    updatedBy: v.updatedByName,
    publishedAt: v.publishedAt,
    publishedBy: v.publishedByName,
    supersededAt: v.supersededAt,
  };
}

/** The class/section a timetable is for (any status: history stays readable). */
export async function sectionRef(
  repos: Repositories,
  sectionId: string,
): Promise<TimetableSectionRef & { active: boolean; label: string }> {
  const section = required(await repos.classes.findSection(sectionId), 'class and section');
  const cls = required(await repos.classes.findClass(section.classId), 'class');
  return {
    sectionId: section.id,
    sectionName: section.name,
    classId: cls.id,
    className: cls.name,
    active: section.status === 'ACTIVE' && cls.status === 'ACTIVE',
    label: `${cls.name} ${section.name}`,
  };
}

/** Readable slot name for messages, e.g. "Monday, Period 3". */
export function slotName(frame: WeekFrame, day: Weekday, periodId: string): string {
  const slot = frame.slotById.get(periodId);
  return `${DAY_NAMES[day]}, ${slot ? slot.label : 'an unknown period'}`;
}

/** Audit snapshot of one entry: what, where and who — names included for readable history. */
export function describeEntry(frame: WeekFrame, e: TimetableEntryRecord) {
  const slot = frame.slotById.get(e.periodId);
  return {
    academicYearId: e.academicYearId,
    academicYear: frame.year.label,
    versionId: e.versionId,
    day: e.day,
    periodId: e.periodId,
    period: slot?.label ?? null,
    sectionId: e.sectionId,
    classSection: `${e.className} ${e.sectionName}`,
    subjectId: e.subjectId,
    subject: e.subjectName,
    teacherId: e.teacherId,
    teacher: e.teacherName,
  };
}
