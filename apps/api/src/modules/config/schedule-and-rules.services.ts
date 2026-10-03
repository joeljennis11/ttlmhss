import {
  orderGradeBands,
  type AttendancePolicyView,
  type DayStructureView,
  type GradeSchemeView,
  type PeriodCreateSchema,
  type PeriodUpdateSchema,
  type PeriodView,
  type GradeSchemeInputSchema,
  type AttendancePolicyUpdateSchema,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import { ConflictError, fieldConflict } from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type { GradeSchemeRecord, PeriodRecord } from './config.repository.js';
import {
  ConfigService,
  defined,
  fromBp,
  required,
  toBp,
  type RequestContext,
} from './config-service.js';
import type { AcademicYearService } from './school-structure.services.js';

// ---------------------------------------------------------------------------
// Periods & breaks
// ---------------------------------------------------------------------------

const describe = (s: PeriodRecord) =>
  `${s.kind === 'LESSON' ? `P${s.periodNumber} (${s.label})` : s.label} ${s.startTime}–${s.endTime}`;

/**
 * Day-structure rules (BR-TT-11):
 * - active periods and breaks may touch but never overlap;
 * - period numbers are unique in the year and follow the order of the day (P1 before P2 …).
 * Inactive slots are kept for history and ignored by the overlap/order checks.
 * `focus` names the slot being changed so the message points at the right form field.
 */
export function checkDaySchedule(slots: readonly PeriodRecord[], focus: PeriodRecord): void {
  const sameNumber = slots.find(
    (s) =>
      s.id !== focus.id && focus.periodNumber !== null && s.periodNumber === focus.periodNumber,
  );
  if (sameNumber) {
    throw fieldConflict(
      'periodNumber',
      `Period ${focus.periodNumber} already exists (${describe(sameNumber)}).`,
    );
  }
  const active = slots
    .filter((s) => s.status === 'ACTIVE')
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  if (focus.status === 'ACTIVE') {
    const clash = active.find(
      (s) => s.id !== focus.id && s.startTime < focus.endTime && focus.startTime < s.endTime,
    );
    if (clash) throw fieldConflict('startTime', `This time overlaps ${describe(clash)}.`);
  }
  const lessons = active.filter((s) => s.kind === 'LESSON');
  for (let i = 1; i < lessons.length; i++) {
    const prev = lessons[i - 1]!;
    const next = lessons[i]!;
    if ((next.periodNumber ?? 0) < (prev.periodNumber ?? 0)) {
      throw fieldConflict(
        'periodNumber',
        `Period numbers must follow the order of the day: P${next.periodNumber} would start after P${prev.periodNumber}.`,
      );
    }
  }
}

export class DayStructureService extends ConfigService {
  constructor(
    deps: ConstructorParameters<typeof ConfigService>[0],
    private readonly years: AcademicYearService,
  ) {
    super(deps);
  }

  private view = (s: PeriodRecord): PeriodView => ({ ...s });

  async get(ctx: RequestContext, academicYearId: string): Promise<DayStructureView> {
    this.authorize(ctx);
    const academicYear = await this.years.getView(academicYearId);
    const slots = await this.repos.periods.listByYear(academicYearId);
    return { academicYear, slots: slots.map(this.view) };
  }

  private async apply(repos: Repositories, yearId: string, next: PeriodRecord) {
    const others = (await repos.periods.listByYear(yearId)).filter((s) => s.id !== next.id);
    checkDaySchedule([...others, next], next);
  }

  async create(
    ctx: RequestContext,
    academicYearId: string,
    input: z.output<typeof PeriodCreateSchema>,
  ): Promise<DayStructureView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      required(await repos.academicYears.find(academicYearId), 'academic year');
      const record: PeriodRecord = {
        id: newId(),
        academicYearId,
        kind: input.kind,
        periodNumber: input.kind === 'LESSON' ? (input.periodNumber ?? null) : null,
        label: input.label,
        startTime: input.startTime,
        endTime: input.endTime,
        status: 'ACTIVE',
      };
      await this.apply(repos, academicYearId, record);
      await repos.periods.create(record, now);
      await repos.periods.resequence(academicYearId, now);
      await audit({
        action: `config.${record.kind === 'LESSON' ? 'period' : 'break'}.created`,
        entityType: 'period',
        entityId: record.id,
        after: record,
      });
    });
    return this.get(ctx, academicYearId);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof PeriodUpdateSchema>,
  ): Promise<DayStructureView> {
    const existing = required(await this.repos.periods.find(id), 'period');
    await this.write(ctx, async ({ repos, now, audit }) => {
      const changes = defined(input);
      if (
        existing.kind === 'BREAK' &&
        changes.periodNumber !== undefined &&
        changes.periodNumber !== null
      ) {
        throw fieldConflict('periodNumber', 'Breaks do not have a period number.');
      }
      if (existing.kind === 'LESSON' && changes.periodNumber === null) {
        throw fieldConflict('periodNumber', 'Enter the period number.');
      }
      const next: PeriodRecord = { ...existing, ...changes } as PeriodRecord;
      if (next.startTime >= next.endTime)
        throw fieldConflict('endTime', 'End time must be after the start time.');
      await this.apply(repos, existing.academicYearId, next);
      await repos.periods.update(id, changes, now);
      await repos.periods.resequence(existing.academicYearId, now);
      await audit({
        action: `config.${existing.kind === 'LESSON' ? 'period' : 'break'}.updated`,
        entityType: 'period',
        entityId: id,
        before: existing,
        after: next,
      });
    });
    return this.get(ctx, existing.academicYearId);
  }

  /** Removes a period or break. Not once any timetable (draft, live or history) uses it. */
  async remove(ctx: RequestContext, id: string): Promise<DayStructureView> {
    const existing = required(await this.repos.periods.find(id), 'period');
    await this.write(ctx, async ({ repos, now, audit }) => {
      if ((await repos.timetable.countForPeriod(id)) > 0) {
        throw new ConflictError(
          `${existing.label} is used by a timetable, so it cannot be deleted. Deactivate it instead.`,
        );
      }
      await repos.periods.delete(id);
      await repos.periods.resequence(existing.academicYearId, now);
      await audit({
        action: `config.${existing.kind === 'LESSON' ? 'period' : 'break'}.deleted`,
        entityType: 'period',
        entityId: id,
        before: existing,
      });
    });
    return this.get(ctx, existing.academicYearId);
  }

  /** Start a year's day structure as a copy of another year's (only when it has none yet). */
  async copy(
    ctx: RequestContext,
    academicYearId: string,
    fromAcademicYearId: string,
  ): Promise<DayStructureView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      required(await repos.academicYears.find(academicYearId), 'academic year');
      const source = required(await repos.academicYears.find(fromAcademicYearId), 'academic year');
      if (fromAcademicYearId === academicYearId)
        throw new ConflictError('Choose a different academic year to copy from.');
      if ((await repos.periods.listByYear(academicYearId)).length > 0) {
        throw new ConflictError(
          'This year already has periods. Copying is only possible into an empty year.',
        );
      }
      const slots = await repos.periods.listByYear(fromAcademicYearId);
      if (slots.length === 0) throw new ConflictError(`${source.label} has no periods to copy.`);
      for (const slot of slots)
        await repos.periods.create({ ...slot, id: newId(), academicYearId }, now);
      await repos.periods.resequence(academicYearId, now);
      await audit({
        action: 'config.periods.copied',
        entityType: 'academic_year',
        entityId: academicYearId,
        after: { from: source.label, count: slots.length },
      });
    });
    return this.get(ctx, academicYearId);
  }
}

// ---------------------------------------------------------------------------
// Attendance locking policy
// ---------------------------------------------------------------------------

export class AttendancePolicyService extends ConfigService {
  /** Null until an administrator saves a policy — attendance then never locks. */
  async get(ctx: RequestContext): Promise<AttendancePolicyView | null> {
    this.authorize(ctx);
    return this.repos.attendancePolicy.get();
  }

  async save(
    ctx: RequestContext,
    input: z.output<typeof AttendancePolicyUpdateSchema>,
  ): Promise<AttendancePolicyView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = await repos.attendancePolicy.get();
      await repos.attendancePolicy.save(input, now);
      await audit({
        action: 'config.attendance_policy.updated',
        entityType: 'attendance_policy',
        entityId: 'default',
        before,
        after: input,
      });
    });
    return required(await this.repos.attendancePolicy.get(), 'attendance policy');
  }
}

// ---------------------------------------------------------------------------
// Grade scales
// ---------------------------------------------------------------------------

export class GradeSchemeService extends ConfigService {
  private toView(record: GradeSchemeRecord, inUse: Set<string>): GradeSchemeView {
    return {
      id: record.id,
      name: record.name,
      status: record.status,
      inUse: inUse.has(record.id),
      updatedAt: record.updatedAt,
      bands: orderGradeBands(
        record.bands.map((b) => ({
          label: b.label,
          minPercent: fromBp(b.minBp),
          remark: b.remark,
        })),
      ),
    };
  }

  async list(ctx: RequestContext): Promise<GradeSchemeView[]> {
    this.authorize(ctx);
    const [schemes, inUse] = await Promise.all([
      this.repos.gradeSchemes.list(),
      this.repos.gradeSchemes.idsInUse(),
    ]);
    return schemes.map((s) => this.toView(s, inUse));
  }

  private async view(id: string) {
    return this.toView(
      required(await this.repos.gradeSchemes.find(id), 'grade scale'),
      await this.repos.gradeSchemes.idsInUse(),
    );
  }

  private async save(
    ctx: RequestContext,
    id: string | null,
    input: z.output<typeof GradeSchemeInputSchema>,
  ) {
    const schemeId = id ?? newId();
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = id ? required(await repos.gradeSchemes.find(id), 'grade scale') : null;
      const clash = await repos.gradeSchemes.findByName(input.name);
      if (clash && clash.id !== schemeId)
        throw fieldConflict('name', `A grade scale named "${clash.name}" already exists.`);
      const record = {
        id: schemeId,
        name: input.name,
        status: input.status ?? before?.status ?? 'ACTIVE',
        bands: input.bands.map((b) => ({
          label: b.label,
          minBp: toBp(b.minPercent),
          remark: b.remark,
        })),
      } as const;
      await repos.gradeSchemes.save({ ...record, bands: [...record.bands] }, now, before === null);
      await audit({
        action: before ? 'config.grade_scale.updated' : 'config.grade_scale.created',
        entityType: 'grade_scale',
        entityId: schemeId,
        before,
        after: record,
      });
    });
    return this.view(schemeId);
  }

  create(ctx: RequestContext, input: z.output<typeof GradeSchemeInputSchema>) {
    return this.save(ctx, null, input);
  }

  update(ctx: RequestContext, id: string, input: z.output<typeof GradeSchemeInputSchema>) {
    return this.save(ctx, id, input);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.write(ctx, async ({ repos, audit }) => {
      const scheme = required(await repos.gradeSchemes.find(id), 'grade scale');
      if ((await repos.gradeSchemes.idsInUse()).has(id)) {
        throw new ConflictError(
          `"${scheme.name}" is used by an exam, so it cannot be deleted. Make it inactive instead.`,
        );
      }
      await repos.gradeSchemes.delete(id);
      await audit({
        action: 'config.grade_scale.deleted',
        entityType: 'grade_scale',
        entityId: id,
        before: scheme,
      });
    });
  }
}
