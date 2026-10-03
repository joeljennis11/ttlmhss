import {
  CALENDAR_DAY_STATUS_LABELS,
  targetsOverlap,
  weekdayOf,
  weeklyWorking,
  type CalendarEntryInputSchema,
  type CalendarEntryView,
  type CalendarView,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import { AuditRecorder, type AuditEvent } from '../../core/audit/audit-recorder.js';
import type { Principal } from '../../core/auth/access.js';
import type { AuthorizationService } from '../../core/auth/authorization.service.js';
import { ConflictError, NotFoundError, fieldConflict } from '../../core/errors/app-errors.js';
import { newId, toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { DataStore, Repositories } from '../../data/data-store.js';
import type {
  AcademicYearRecord,
  ClassRecord,
  SectionRecord,
} from '../config/config.repository.js';
import type { CalendarEntryRecord, CalendarEntryWrite } from './calendar.repository.js';

type Input = z.output<typeof CalendarEntryInputSchema>;

export interface RequestContext {
  principal: Principal | null;
  requestId: string | null;
}

export interface CalendarServiceDeps {
  dataStore: DataStore;
  clock: Clock;
  authorization: AuthorizationService;
}

interface Structure {
  classes: ClassRecord[];
  sections: SectionRecord[];
  classById: Map<string, ClassRecord>;
  sectionById: Map<string, SectionRecord>;
}

async function loadStructure(repos: Repositories): Promise<Structure> {
  const [classes, sections] = await Promise.all([
    repos.classes.listClasses(),
    repos.classes.listSections(),
  ]);
  const ordered = [...classes].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
  return {
    classes: ordered,
    sections,
    classById: new Map(classes.map((c) => [c.id, c])),
    sectionById: new Map(sections.map((s) => [s.id, s])),
  };
}

const PERMISSION = 'config.manage' as const;

/**
 * Academic calendar administration (Phase 8A). School configuration: administrators only
 * (`config.manage`, like every School setup page). Every change runs in one transaction with its
 * audit entry. Validation keeps the calendar unambiguous: an entry's date lies in its year, its
 * classes/sections exist and are active, it actually changes something, and it never overlaps
 * another entry on the same date (BR-CAL-04).
 */
export class CalendarService {
  constructor(private readonly deps: CalendarServiceDeps) {}

  private authorize(ctx: RequestContext): Principal {
    return this.deps.authorization.authorize(ctx.principal, PERMISSION);
  }

  private async write<T>(
    ctx: RequestContext,
    work: (s: {
      repos: Repositories;
      now: string;
      actor: Principal;
      audit: (e: AuditEvent) => Promise<void>;
    }) => Promise<T>,
  ): Promise<T> {
    const actor = this.authorize(ctx);
    return this.deps.dataStore.transaction(async (repos) => {
      const recorder = new AuditRecorder(repos.auditLogs, this.deps.clock);
      return work({
        repos,
        actor,
        now: toTimestamp(this.deps.clock.now()),
        audit: (e) =>
          recorder
            .record(e, { actorUserId: actor.userId, requestId: ctx.requestId })
            .then(() => undefined),
      });
    });
  }

  // ---- reading -----------------------------------------------------------------------------------

  async get(ctx: RequestContext, academicYearId: string): Promise<CalendarView> {
    this.authorize(ctx);
    const repos = this.deps.dataStore.repositories;
    const year = await repos.academicYears.find(academicYearId);
    if (!year) throw new NotFoundError('That academic year was not found.');
    const [entries, structure] = await Promise.all([
      repos.calendar.listByYear(year.id),
      loadStructure(repos),
    ]);
    return {
      academicYear: {
        id: year.id,
        label: year.label,
        status: year.status,
        startDate: year.startDate,
        endDate: year.endDate,
        workingDays: year.workingDays,
      },
      readOnly: year.status === 'CLOSED',
      entries: entries.map((e) => toView(e, year, structure)),
      classes: structure.classes.map((c) => ({
        id: c.id,
        name: c.name,
        displayOrder: c.displayOrder,
        active: c.status === 'ACTIVE',
        sections: structure.sections
          .filter((s) => s.classId === c.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({ id: s.id, name: s.name, active: s.status === 'ACTIVE' })),
      })),
    };
  }

  // ---- changing ----------------------------------------------------------------------------------

  async create(ctx: RequestContext, academicYearId: string, input: Input): Promise<CalendarView> {
    const id = newId();
    await this.write(ctx, async ({ repos, now, actor, audit }) => {
      const year = await this.openYear(repos, academicYearId);
      const structure = await loadStructure(repos);
      const entry: CalendarEntryWrite = { id, academicYearId: year.id, ...pick(input) };
      await this.validate(repos, year, structure, entry, null);
      await repos.calendar.create(entry, actor.userId, now);
      await audit({
        action: 'calendar.entry_created',
        entityType: 'calendar_entry',
        entityId: id,
        after: snapshot(entry, year, structure),
        reason: entry.reason,
      });
    });
    return this.get(ctx, academicYearId);
  }

  async update(ctx: RequestContext, id: string, input: Input): Promise<CalendarView> {
    let yearId = '';
    await this.write(ctx, async ({ repos, now, actor, audit }) => {
      const existing = await repos.calendar.find(id);
      if (!existing) throw new NotFoundError('That calendar entry was not found.');
      const year = await this.openYear(repos, existing.academicYearId);
      yearId = year.id;
      const structure = await loadStructure(repos);
      const entry: CalendarEntryWrite = { id, academicYearId: year.id, ...pick(input) };
      await this.validate(repos, year, structure, entry, existing);
      await repos.calendar.update(entry, actor.userId, now);
      await audit({
        action: 'calendar.entry_updated',
        entityType: 'calendar_entry',
        entityId: id,
        before: snapshot(existing, year, structure),
        after: snapshot(entry, year, structure),
        reason: entry.reason,
      });
    });
    return this.get(ctx, yearId);
  }

  /**
   * Remove an exception: the date goes back to the weekly pattern for those classes. Saved
   * attendance is never touched (BR-CAL-07); the audit entry keeps the full removed entry.
   */
  async remove(ctx: RequestContext, id: string): Promise<CalendarView> {
    let yearId = '';
    await this.write(ctx, async ({ repos, audit }) => {
      const existing = await repos.calendar.find(id);
      if (!existing) throw new NotFoundError('That calendar entry was not found.');
      const year = await this.openYear(repos, existing.academicYearId);
      yearId = year.id;
      const structure = await loadStructure(repos);
      await repos.calendar.delete(id);
      await audit({
        action: 'calendar.entry_deleted',
        entityType: 'calendar_entry',
        entityId: id,
        before: snapshot(existing, year, structure),
        reason: existing.reason,
      });
    });
    return this.get(ctx, yearId);
  }

  // ---- rules -------------------------------------------------------------------------------------

  private async openYear(repos: Repositories, id: string): Promise<AcademicYearRecord> {
    const year = await repos.academicYears.find(id);
    if (!year) throw new NotFoundError('That academic year was not found.');
    if (year.status === 'CLOSED') {
      throw new ConflictError(
        `${year.label} is closed. Its calendar is kept as history and cannot be changed.`,
      );
    }
    return year;
  }

  private async validate(
    repos: Repositories,
    year: AcademicYearRecord,
    s: Structure,
    entry: CalendarEntryWrite,
    existing: CalendarEntryRecord | null,
  ): Promise<void> {
    if (entry.date < year.startDate || entry.date > year.endDate) {
      throw fieldConflict(
        'date',
        `The date must fall within ${year.label} (${year.startDate} to ${year.endDate}).`,
      );
    }
    for (const classId of entry.classIds) {
      const cls = s.classById.get(classId);
      if (!cls) throw fieldConflict('classIds', 'One of the classes was not found.');
      if (cls.status !== 'ACTIVE' && !existing?.classIds.includes(classId)) {
        throw fieldConflict('classIds', `${cls.name} is inactive.`);
      }
    }
    for (const sectionId of entry.sectionIds) {
      const section = s.sectionById.get(sectionId);
      if (!section) throw fieldConflict('sectionIds', 'One of the sections was not found.');
      const cls = s.classById.get(section.classId);
      const label = `${cls?.name ?? ''} ${section.name}`.trim();
      if (
        (section.status !== 'ACTIVE' || cls?.status !== 'ACTIVE') &&
        !existing?.sectionIds.includes(sectionId)
      ) {
        throw fieldConflict('sectionIds', `${label} is inactive.`);
      }
    }
    // An entry must change something: a Working day on a weekly working day (or a Holiday on a
    // weekly non-working day) would have no effect and only confuse.
    const weekly = weeklyWorking(year, entry.date);
    if (weekly === (entry.status === 'WORKING')) {
      const day = DAY_NAMES[weekdayOf(entry.date)];
      throw fieldConflict(
        'status',
        weekly
          ? `${entry.date} (${day}) is already a working day in the weekly pattern. Add a holiday instead, or change the weekly working days.`
          : `${entry.date} (${day}) is already a non-working day in the weekly pattern.`,
      );
    }
    // BR-CAL-04: never two entries for the same class/section on one date.
    const sameDay = await repos.calendar.listOnDate(year.id, entry.date);
    const classOf = (sectionId: string) => s.sectionById.get(sectionId)?.classId;
    const clash = sameDay.find(
      (other) => other.id !== entry.id && targetsOverlap(entry, other, classOf),
    );
    if (clash) {
      throw fieldConflict(
        'scope',
        `${entry.date} already has "${CALENDAR_DAY_STATUS_LABELS[clash.status]} — ${appliesToLabel(clash, s)}" (${clash.reason}), which covers some of the same classes. Edit that entry, or choose classes that do not overlap.`,
      );
    }
  }
}

const DAY_NAMES = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
} as const;

function pick(input: Input) {
  return {
    date: input.date,
    status: input.status,
    scope: input.scope,
    classIds: input.scope === 'CLASSES' ? [...input.classIds] : [],
    sectionIds: input.scope === 'SECTIONS' ? [...input.sectionIds] : [],
    reason: input.reason,
    note: input.note,
  };
}

/** "Entire school", "Classes 11, 12", "Class 12", "10 A, 10 B". */
export function appliesToLabel(
  e: Pick<CalendarEntryWrite, 'scope' | 'classIds' | 'sectionIds'>,
  s: Structure,
): string {
  if (e.scope === 'SCHOOL') return 'Entire school';
  if (e.scope === 'CLASSES') {
    const names = s.classes.filter((c) => e.classIds.includes(c.id)).map((c) => c.name);
    return `${names.length === 1 ? 'Class' : 'Classes'} ${names.join(', ')}`;
  }
  const names = e.sectionIds
    .map((id) => s.sectionById.get(id))
    .filter((x): x is SectionRecord => x !== undefined)
    .map((sec) => ({ sec, cls: s.classById.get(sec.classId) }))
    .sort(
      (a, b) =>
        (a.cls?.displayOrder ?? 0) - (b.cls?.displayOrder ?? 0) ||
        a.sec.name.localeCompare(b.sec.name),
    )
    .map(({ sec, cls }) => `${cls?.name ?? ''} ${sec.name}`.trim());
  return `${names.length === 1 ? 'Section' : 'Sections'} ${names.join(', ')}`;
}

function snapshot(e: CalendarEntryWrite, year: AcademicYearRecord, s: Structure) {
  return {
    academicYearId: year.id,
    academicYear: year.label,
    date: e.date,
    status: e.status,
    scope: e.scope,
    classIds: e.classIds,
    sectionIds: e.sectionIds,
    appliesTo: appliesToLabel(e, s),
    reason: e.reason,
    note: e.note,
  };
}

function toView(e: CalendarEntryRecord, year: AcademicYearRecord, s: Structure): CalendarEntryView {
  return {
    id: e.id,
    academicYearId: e.academicYearId,
    date: e.date,
    day: weekdayOf(e.date),
    status: e.status,
    scope: e.scope,
    classes: s.classes
      .filter((c) => e.classIds.includes(c.id))
      .map((c) => ({ id: c.id, name: c.name })),
    sections: e.sectionIds.flatMap((id) => {
      const sec = s.sectionById.get(id);
      const cls = sec ? s.classById.get(sec.classId) : undefined;
      return sec && cls
        ? [{ id: sec.id, name: sec.name, classId: cls.id, className: cls.name }]
        : [];
    }),
    appliesTo: appliesToLabel(e, s),
    weeklyWorking: weeklyWorking(year, e.date),
    reason: e.reason,
    note: e.note,
    createdAt: e.createdAt,
    createdBy: e.createdByName,
    updatedAt: e.updatedAt,
    updatedBy: e.updatedByName,
  };
}
