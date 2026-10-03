import type { z } from 'zod';
import type {
  ClassUpdateSchema,
  SectionUpdateSchema,
  SchoolSettingsUpdateSchema,
  SubjectCreateSchema,
  SubjectUpdateSchema,
} from '@ttlmhss/shared';
import type {
  AcademicYearCreate,
  AcademicYearUpdate,
  AcademicYearView,
  ClassCreate,
  ClassView,
  RecordStatus,
  SchoolSettingsView,
  SubjectView,
  Weekday,
} from '@ttlmhss/shared';
import { ConflictError, InternalError, fieldConflict } from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord } from './config.repository.js';
import { ConfigService, defined, required, type RequestContext } from './config-service.js';

// ---------------------------------------------------------------------------
// School settings
// ---------------------------------------------------------------------------

export class SchoolSettingsService extends ConfigService {
  async get(ctx: RequestContext): Promise<SchoolSettingsView> {
    this.authorize(ctx);
    return this.view();
  }

  private async view(): Promise<SchoolSettingsView> {
    const settings = await this.repos.schoolSettings.get();
    if (!settings) throw new InternalError('School settings missing — run database migrations');
    const current = await this.repos.academicYears.findCurrent();
    return {
      fullName: settings.fullName,
      shortName: settings.shortName,
      motto: settings.motto,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      principalName: settings.principalName,
      logoUrl: settings.logoPath,
      primaryColor: settings.primaryColor,
      updatedAt: settings.updatedAt,
      currentAcademicYear: current ? { id: current.id, label: current.label } : null,
    };
  }

  async update(
    ctx: RequestContext,
    input: z.output<typeof SchoolSettingsUpdateSchema>,
  ): Promise<SchoolSettingsView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = await repos.schoolSettings.get();
      const after = {
        fullName: input.fullName,
        shortName: input.shortName,
        motto: input.motto,
        address: input.address,
        phone: input.phone,
        email: input.email,
        website: input.website,
        principalName: input.principalName,
        logoPath: input.logoUrl,
      };
      await repos.schoolSettings.update(after, now);
      await audit({
        action: 'config.school_settings.updated',
        entityType: 'school_settings',
        entityId: 'default',
        before,
        after,
      });
    });
    return this.view();
  }
}

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------

function overlaps(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export class AcademicYearService extends ConfigService {
  private toView(record: AcademicYearRecord, inUse: Set<string>): AcademicYearView {
    return {
      id: record.id,
      label: record.label,
      startDate: record.startDate,
      endDate: record.endDate,
      status: record.status,
      workingDays: record.workingDays,
      inUse: inUse.has(record.id),
      updatedAt: record.updatedAt,
    };
  }

  async list(ctx: RequestContext): Promise<AcademicYearView[]> {
    this.authorize(ctx);
    const [years, inUse] = await Promise.all([
      this.repos.academicYears.list(),
      this.repos.academicYears.idsInUse(),
    ]);
    return years.map((y) => this.toView(y, inUse));
  }

  async getView(id: string): Promise<AcademicYearView> {
    const year = required(await this.repos.academicYears.find(id), 'academic year');
    return this.toView(year, await this.repos.academicYears.idsInUse());
  }

  /** Label unique (case-insensitive) and no date overlap with another year. */
  private async checkRules(
    repos: Repositories,
    candidate: { id: string; label: string; startDate: string; endDate: string },
  ) {
    const sameLabel = await repos.academicYears.findByLabel(candidate.label);
    if (sameLabel && sameLabel.id !== candidate.id) {
      throw fieldConflict('label', `An academic year named "${sameLabel.label}" already exists.`);
    }
    const clash = (await repos.academicYears.list()).find(
      (y) => y.id !== candidate.id && overlaps(y, candidate),
    );
    if (clash) {
      throw fieldConflict(
        'startDate',
        `These dates overlap ${clash.label} (${clash.startDate} to ${clash.endDate}).`,
      );
    }
  }

  async create(ctx: RequestContext, input: AcademicYearCreate): Promise<AcademicYearView> {
    const id = newId();
    await this.write(ctx, async ({ repos, now, audit }) => {
      const record: AcademicYearRecord = {
        id,
        label: input.label,
        startDate: input.startDate,
        endDate: input.endDate,
        status: 'UPCOMING',
        workingDays: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.checkRules(repos, record);
      await repos.academicYears.create(record);
      await audit({
        action: 'config.academic_year.created',
        entityType: 'academic_year',
        entityId: id,
        after: record,
      });
    });
    return this.getView(id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: AcademicYearUpdate,
  ): Promise<AcademicYearView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = required(await repos.academicYears.find(id), 'academic year');
      const after = { ...before, ...defined(input) };
      if (after.startDate >= after.endDate) {
        throw fieldConflict('endDate', 'End date must be after the start date.');
      }
      await this.checkRules(repos, after);
      // Exams already dated in this year must still fall inside it.
      const outside = (await repos.exams.listByYear(id)).find(
        (e) =>
          (e.startDate && e.startDate < after.startDate) ||
          (e.endDate && e.endDate > after.endDate),
      );
      if (outside) {
        throw fieldConflict(
          'startDate',
          `The exam "${outside.name}" has dates outside the new range. Change the exam first.`,
        );
      }
      await repos.academicYears.update(id, defined(input), now);
      await audit({
        action: 'config.academic_year.updated',
        entityType: 'academic_year',
        entityId: id,
        before,
        after,
      });
    });
    return this.getView(id);
  }

  /**
   * Deliberately make a year the current one (BR-AY-02: exactly one current year). The previous
   * current year becomes CLOSED if it started earlier, otherwise UPCOMING. Nothing else changes —
   * no rollover or promotion happens here.
   */
  async makeCurrent(ctx: RequestContext, id: string): Promise<AcademicYearView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      const target = required(await repos.academicYears.find(id), 'academic year');
      if (target.status === 'CURRENT') return;
      const previous = await repos.academicYears.findCurrent();
      if (previous) {
        const status = previous.startDate < target.startDate ? 'CLOSED' : 'UPCOMING';
        await repos.academicYears.update(previous.id, { status }, now);
      }
      await repos.academicYears.update(id, { status: 'CURRENT' }, now);
      await audit({
        action: 'config.academic_year.made_current',
        entityType: 'academic_year',
        entityId: id,
        before: { current: previous ? { id: previous.id, label: previous.label } : null },
        after: { current: { id, label: target.label } },
      });
    });
    return this.getView(id);
  }

  async setWorkingDays(
    ctx: RequestContext,
    id: string,
    workingDays: Weekday[],
  ): Promise<AcademicYearView> {
    const order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const sorted = [...workingDays].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = required(await repos.academicYears.find(id), 'academic year');
      await repos.academicYears.update(id, { workingDays: sorted }, now);
      await audit({
        action: 'config.academic_year.working_days_set',
        entityType: 'academic_year',
        entityId: id,
        before: { workingDays: before.workingDays },
        after: { workingDays: sorted },
      });
    });
    return this.getView(id);
  }

  /** Only a year nothing depends on, and not the current one, can be removed (e.g. a mistake). */
  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.write(ctx, async ({ repos, audit }) => {
      const year = required(await repos.academicYears.find(id), 'academic year');
      if (year.status === 'CURRENT')
        throw new ConflictError('The current academic year cannot be deleted.');
      if ((await repos.academicYears.idsInUse()).has(id)) {
        throw new ConflictError(
          `${year.label} already has periods, exams or other records, so it cannot be deleted.`,
        );
      }
      await repos.academicYears.delete(id);
      await audit({
        action: 'config.academic_year.deleted',
        entityType: 'academic_year',
        entityId: id,
        before: year,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Classes & sections
// ---------------------------------------------------------------------------

export class ClassService extends ConfigService {
  async list(ctx: RequestContext): Promise<ClassView[]> {
    this.authorize(ctx);
    const [classes, sections] = await Promise.all([
      this.repos.classes.listClasses(),
      this.repos.classes.listSections(),
    ]);
    return classes.map((c) => ({ ...c, sections: sections.filter((s) => s.classId === c.id) }));
  }

  private async classView(id: string): Promise<ClassView> {
    const cls = required(await this.repos.classes.findClass(id), 'class');
    const sections = (await this.repos.classes.listSections()).filter((s) => s.classId === id);
    return { ...cls, sections };
  }

  async createClass(ctx: RequestContext, input: ClassCreate): Promise<ClassView> {
    const id = newId();
    await this.write(ctx, async ({ repos, now, audit }) => {
      if (await repos.classes.findClassByName(input.name)) {
        throw fieldConflict('name', `A class named "${input.name}" already exists.`);
      }
      const record = {
        id,
        name: input.name,
        displayOrder: input.displayOrder,
        status: 'ACTIVE' as RecordStatus,
      };
      await repos.classes.createClass(record, now);
      await audit({
        action: 'config.class.created',
        entityType: 'class',
        entityId: id,
        after: record,
      });
    });
    return this.classView(id);
  }

  async updateClass(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof ClassUpdateSchema>,
  ): Promise<ClassView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = required(await repos.classes.findClass(id), 'class');
      if (input.name !== undefined) {
        const clash = await repos.classes.findClassByName(input.name);
        if (clash && clash.id !== id)
          throw fieldConflict('name', `A class named "${clash.name}" already exists.`);
      }
      const changes = defined(input);
      await repos.classes.updateClass(id, changes, now);
      await audit({
        action: 'config.class.updated',
        entityType: 'class',
        entityId: id,
        before,
        after: { ...before, ...changes },
      });
    });
    return this.classView(id);
  }

  async createSection(
    ctx: RequestContext,
    classId: string,
    input: { name: string },
  ): Promise<ClassView> {
    await this.write(ctx, async ({ repos, now, audit }) => {
      const cls = required(await repos.classes.findClass(classId), 'class');
      if (await repos.classes.findSectionByName(classId, input.name)) {
        throw fieldConflict('name', `${cls.name} already has a section "${input.name}".`);
      }
      const record = { id: newId(), classId, name: input.name, status: 'ACTIVE' as RecordStatus };
      await repos.classes.createSection(record, now);
      await audit({
        action: 'config.section.created',
        entityType: 'section',
        entityId: record.id,
        after: record,
      });
    });
    return this.classView(classId);
  }

  async updateSection(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof SectionUpdateSchema>,
  ): Promise<ClassView> {
    const section = required(await this.repos.classes.findSection(id), 'section');
    await this.write(ctx, async ({ repos, now, audit }) => {
      if (input.name !== undefined) {
        const clash = await repos.classes.findSectionByName(section.classId, input.name);
        if (clash && clash.id !== id)
          throw fieldConflict('name', `This class already has a section "${clash.name}".`);
      }
      const changes = defined(input);
      await repos.classes.updateSection(id, changes, now);
      await audit({
        action: 'config.section.updated',
        entityType: 'section',
        entityId: id,
        before: section,
        after: { ...section, ...changes },
      });
    });
    return this.classView(section.classId);
  }
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export class SubjectService extends ConfigService {
  async list(ctx: RequestContext): Promise<SubjectView[]> {
    this.authorize(ctx);
    return this.repos.subjects.list();
  }

  private async checkUnique(
    repos: Repositories,
    id: string | null,
    name?: string,
    code?: string | null,
  ) {
    if (name !== undefined) {
      const clash = await repos.subjects.findByName(name);
      if (clash && clash.id !== id)
        throw fieldConflict('name', `A subject named "${clash.name}" already exists.`);
    }
    if (code) {
      const clash = await repos.subjects.findByCode(code);
      if (clash && clash.id !== id)
        throw fieldConflict('code', `The code ${code} is already used by ${clash.name}.`);
    }
  }

  async create(
    ctx: RequestContext,
    input: z.output<typeof SubjectCreateSchema>,
  ): Promise<SubjectView> {
    const record = {
      id: newId(),
      name: input.name,
      code: input.code,
      displayOrder: input.displayOrder,
      status: 'ACTIVE' as RecordStatus,
    };
    await this.write(ctx, async ({ repos, now, audit }) => {
      await this.checkUnique(repos, null, record.name, record.code);
      await repos.subjects.create(record, now);
      await audit({
        action: 'config.subject.created',
        entityType: 'subject',
        entityId: record.id,
        after: record,
      });
    });
    return record;
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof SubjectUpdateSchema>,
  ): Promise<SubjectView> {
    let after: SubjectView | undefined;
    await this.write(ctx, async ({ repos, now, audit }) => {
      const before = required(await repos.subjects.find(id), 'subject');
      await this.checkUnique(repos, id, input.name, input.code);
      const changes = defined(input) as Partial<SubjectView>;
      await repos.subjects.update(id, changes, now);
      after = { ...before, ...changes };
      await audit({
        action: 'config.subject.updated',
        entityType: 'subject',
        entityId: id,
        before,
        after,
      });
    });
    return after!;
  }
}
