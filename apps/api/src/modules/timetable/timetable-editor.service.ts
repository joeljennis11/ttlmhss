import type {
  TimetableChangesSchema,
  TimetableEditorView,
  TimetableOperation,
  TimetableOptions,
  TimetableVersionList,
  TimetableVersionView,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import type { Principal } from '../../core/auth/access.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  fieldConflict,
} from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type { AcademicYearRecord } from '../config/config.repository.js';
import type { TimetableEntryRecord, TimetableVersionRecord } from './timetable.repository.js';
import { checkFree, checkSlot, checkTeaching, draftIssues } from './timetable-rules.js';
import {
  RollbackWith,
  TimetableServiceBase,
  describeEntry,
  gridFor,
  loadFrame,
  required,
  sectionRef,
  sortEntries,
  toEntryView,
  toVersionView,
  type RequestContext,
  type WeekFrame,
  type WriteScope,
} from './timetable-service.js';

type Changes = z.output<typeof TimetableChangesSchema>;

function editableYear(year: AcademicYearRecord): void {
  if (year.status === 'CLOSED') {
    throw new ConflictError(
      `${year.label} is closed. Its timetable is kept as history and cannot be changed.`,
    );
  }
}

/**
 * Timetable editing (BR-TT-07): DRAFT → SAVE → PUBLISH.
 *
 * - A year has at most one draft. Starting one copies the published timetable (or starts empty).
 * - Changes (create / update / move / remove) are sent as a batch and applied in ONE transaction,
 *   each validated against the draft as it stands after the previous change; any failure rejects
 *   the whole batch. A dry run applies the same checks and rolls back (used by the editor to
 *   validate a drag-and-drop before showing it).
 * - Publishing validates the whole draft and, in one transaction, supersedes the live version and
 *   makes the draft live. The published version is never edited; changes always go through a draft.
 */
export class TimetableEditorService extends TimetableServiceBase {
  // ---- reading ---------------------------------------------------------------------------------

  async editor(
    ctx: RequestContext,
    academicYearId: string,
    sectionId: string,
  ): Promise<TimetableEditorView> {
    const principal = this.authorize(ctx, 'timetable.manage');
    this.checkManageSection(principal, sectionId);
    const year = required(await this.repos.academicYears.find(academicYearId), 'academic year');
    return this.buildEditor(this.repos, principal, year, sectionId);
  }

  private async buildEditor(
    repos: Repositories,
    principal: Principal,
    year: AcademicYearRecord,
    sectionId: string,
  ): Promise<TimetableEditorView> {
    const [section, frame, draft, published] = await Promise.all([
      sectionRef(repos, sectionId),
      loadFrame(repos, year),
      repos.timetable.versionWithStatus(year.id, 'DRAFT'),
      repos.timetable.versionWithStatus(year.id, 'PUBLISHED'),
    ]);
    const shown = draft ?? published;
    const entries = shown ? await repos.timetable.listEntries(shown.id, { sectionId }) : [];
    const canPublish = principal.permissions.has('timetable.publish');
    // Publishers see every problem in the draft (they publish the whole school); a class teacher
    // sees the problems of the section in front of them.
    const issues = draft
      ? await draftIssues(
          repos,
          frame,
          canPublish ? await repos.timetable.listEntries(draft.id) : entries,
        )
      : [];
    const { active: _a, label: _l, ...sectionView } = section;
    return {
      ...gridFor(frame, entries, sectionId),
      section: sectionView,
      draft: draft ? toVersionView(draft) : null,
      published: published ? toVersionView(published) : null,
      entries: sortEntries(frame, entries).map(toEntryView),
      issues,
      canPublish,
      readOnlyYear: year.status === 'CLOSED',
    };
  }

  /** Choices for the editor: the caller's sections, active subjects and active teachers. */
  async options(ctx: RequestContext, academicYearId: string): Promise<TimetableOptions> {
    const principal = this.authorize(ctx, 'timetable.manage');
    const repos = this.repos;
    required(await repos.academicYears.find(academicYearId), 'academic year');
    const [classes, sections, subjects, teachers] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
      repos.subjects.list(),
      repos.teachers.list({
        q: null,
        subjectId: null,
        status: 'ACTIVE',
        designation: null,
        offset: 0,
        limit: 100_000,
      }),
    ]);
    const assigned = await repos.teacherSubjects.forTeachers(teachers.rows.map((t) => t.id));
    const activeClasses = classes.filter((c) => c.status === 'ACTIVE');
    return {
      sections: activeClasses.flatMap((c) =>
        sections
          .filter(
            (s) =>
              s.classId === c.id && s.status === 'ACTIVE' && this.canManageSection(principal, s.id),
          )
          .map((s) => ({
            sectionId: s.id,
            sectionName: s.name,
            classId: c.id,
            className: c.name,
          })),
      ),
      subjects: subjects
        .filter((s) => s.status === 'ACTIVE')
        .map((s) => ({ id: s.id, name: s.name, code: s.code })),
      teachers: teachers.rows.map((t) => ({
        id: t.id,
        fullName: t.fullName,
        staffCode: t.staffCode,
        subjectIds: (assigned.get(t.id) ?? [])
          .filter((s) => s.status === 'ACTIVE')
          .map((s) => s.id),
      })),
    };
  }

  async versions(ctx: RequestContext, academicYearId: string): Promise<TimetableVersionList> {
    this.authorize(ctx, 'timetable.manage');
    required(await this.repos.academicYears.find(academicYearId), 'academic year');
    const items = await this.repos.timetable.listVersions(academicYearId);
    return { items: items.map(toVersionView) };
  }

  // ---- draft lifecycle ---------------------------------------------------------------------------

  /** Start the year's draft as a copy of the published timetable (or empty when none). */
  async startDraft(ctx: RequestContext, academicYearId: string): Promise<TimetableVersionView> {
    const id = newId();
    await this.write(ctx, 'timetable.manage', async ({ repos, now, actor, audit }) => {
      // Only an administrator or a class teacher (of some section) may edit at all.
      if (!this.isAdmin(actor) && actor.classTeacherOf.length === 0) {
        throw new ForbiddenError('You can only change the timetable of your own class.');
      }
      const year = required(await repos.academicYears.find(academicYearId), 'academic year');
      editableYear(year);
      if (await repos.timetable.versionWithStatus(year.id, 'DRAFT')) {
        throw new ConflictError(
          `${year.label} already has a draft timetable. Continue editing it.`,
        );
      }
      const published = await repos.timetable.versionWithStatus(year.id, 'PUBLISHED');
      const versionNumber = await repos.timetable.nextVersionNumber(year.id);
      await repos.timetable.createDraft(
        { id, academicYearId: year.id, versionNumber },
        actor.userId,
        now,
      );
      const copied = published
        ? await repos.timetable.copyEntries(published.id, id, actor.userId, now)
        : 0;
      await audit({
        action: 'timetable.draft_created',
        entityType: 'timetable_version',
        entityId: id,
        after: {
          academicYearId: year.id,
          academicYear: year.label,
          versionNumber,
          copiedFromVersion: published?.versionNumber ?? null,
          entries: copied,
        },
      });
    });
    return toVersionView(required(await this.repos.timetable.findVersion(id), 'timetable version'));
  }

  /** Apply a batch of changes to the draft (or only validate them, `dryRun`). */
  async applyChanges(
    ctx: RequestContext,
    academicYearId: string,
    input: Changes,
  ): Promise<TimetableEditorView> {
    const principal = this.authorize(ctx, 'timetable.manage');
    this.checkManageSection(principal, input.sectionId);
    try {
      return await this.write(ctx, 'timetable.manage', async (scope) => {
        const { repos, now, actor, audit } = scope;
        const year = required(await repos.academicYears.find(academicYearId), 'academic year');
        editableYear(year);
        const draft = await repos.timetable.versionWithStatus(year.id, 'DRAFT');
        if (!draft) {
          throw new ConflictError(
            `${year.label} has no draft timetable. Start a draft before making changes; the published timetable is never edited directly.`,
          );
        }
        const frame = await loadFrame(repos, year);
        for (const [index, op] of input.operations.entries()) {
          await this.applyOne(scope, frame, draft, op, (name) => `operations.${index}.${name}`);
        }
        await repos.timetable.touch(draft.id, actor.userId, now);
        await audit({
          action: 'timetable.draft_saved',
          entityType: 'timetable_version',
          entityId: draft.id,
          after: {
            academicYearId: year.id,
            academicYear: year.label,
            versionNumber: draft.versionNumber,
            changes: input.operations.length,
          },
        });
        const view = await this.buildEditor(repos, actor, year, input.sectionId);
        if (input.dryRun) throw new RollbackWith(view);
        return view;
      });
    } catch (error) {
      if (error instanceof RollbackWith) return error.result as TimetableEditorView;
      throw error;
    }
  }

  private async draftEntry(
    repos: Repositories,
    draft: TimetableVersionRecord,
    entryId: string,
  ): Promise<TimetableEntryRecord> {
    const entry = await repos.timetable.findEntry(entryId);
    if (!entry || entry.versionId !== draft.id) {
      throw new NotFoundError(
        'That lesson is no longer in the draft. Reload the timetable to see the latest changes.',
      );
    }
    return entry;
  }

  private async applyOne(
    { repos, now, actor, audit }: WriteScope,
    frame: WeekFrame,
    draft: TimetableVersionRecord,
    op: TimetableOperation,
    field: (name: string) => string,
  ): Promise<void> {
    const audited = (action: string, before: unknown, after: unknown, entityId: string) =>
      audit({ action, entityType: 'timetable_entry', entityId, before, after });

    switch (op.op) {
      case 'create': {
        const section = await sectionRef(repos, op.sectionId);
        this.checkManageSection(actor, section.sectionId, section.label);
        if (!section.active) {
          throw fieldConflict(field('sectionId'), `${section.label} is inactive.`);
        }
        checkSlot(frame, section.sectionId, op.day, op.periodId, field);
        const { teacher } = await checkTeaching(repos, op.subjectId, op.teacherId, field);
        await checkFree(
          repos,
          frame,
          draft.id,
          {
            sectionId: section.sectionId,
            sectionLabel: section.label,
            teacherId: teacher.id,
            teacherName: teacher.fullName,
          },
          op.day,
          op.periodId,
          null,
          field,
        );
        if (await repos.timetable.findEntry(op.id)) {
          throw fieldConflict(field('id'), 'This lesson was already added. Reload the timetable.');
        }
        await repos.timetable.insertEntry(
          {
            id: op.id,
            versionId: draft.id,
            academicYearId: frame.year.id,
            day: op.day,
            periodId: op.periodId,
            sectionId: section.sectionId,
            subjectId: op.subjectId,
            teacherId: op.teacherId,
          },
          actor.userId,
          now,
        );
        const created = required(await repos.timetable.findEntry(op.id), 'lesson');
        await audited('timetable.entry_created', null, describeEntry(frame, created), op.id);
        return;
      }
      case 'update': {
        const entry = await this.draftEntry(repos, draft, op.entryId);
        const label = `${entry.className} ${entry.sectionName}`;
        this.checkManageSection(actor, entry.sectionId, label);
        if (entry.subjectId === op.subjectId && entry.teacherId === op.teacherId) return;
        const { teacher } = await checkTeaching(repos, op.subjectId, op.teacherId, field);
        await checkFree(
          repos,
          frame,
          draft.id,
          {
            sectionId: entry.sectionId,
            sectionLabel: label,
            teacherId: teacher.id,
            teacherName: teacher.fullName,
          },
          entry.day,
          entry.periodId,
          entry.id,
          field,
        );
        await repos.timetable.updateEntry(
          entry.id,
          { subjectId: op.subjectId, teacherId: op.teacherId },
          actor.userId,
          now,
        );
        const after = required(await repos.timetable.findEntry(entry.id), 'lesson');
        await audited(
          'timetable.entry_updated',
          describeEntry(frame, entry),
          describeEntry(frame, after),
          entry.id,
        );
        return;
      }
      case 'move': {
        const entry = await this.draftEntry(repos, draft, op.entryId);
        const label = `${entry.className} ${entry.sectionName}`;
        this.checkManageSection(actor, entry.sectionId, label);
        if (entry.day === op.day && entry.periodId === op.periodId) return;
        checkSlot(frame, entry.sectionId, op.day, op.periodId, field);
        await checkFree(
          repos,
          frame,
          draft.id,
          {
            sectionId: entry.sectionId,
            sectionLabel: label,
            teacherId: entry.teacherId,
            teacherName: entry.teacherName,
          },
          op.day,
          op.periodId,
          entry.id,
          field,
        );
        await repos.timetable.updateEntry(
          entry.id,
          { day: op.day, periodId: op.periodId },
          actor.userId,
          now,
        );
        const after = required(await repos.timetable.findEntry(entry.id), 'lesson');
        await audited(
          'timetable.entry_moved',
          describeEntry(frame, entry),
          describeEntry(frame, after),
          entry.id,
        );
        return;
      }
      case 'remove': {
        const entry = await this.draftEntry(repos, draft, op.entryId);
        this.checkManageSection(actor, entry.sectionId, `${entry.className} ${entry.sectionName}`);
        await repos.timetable.deleteEntry(entry.id);
        await audited('timetable.entry_removed', describeEntry(frame, entry), null, entry.id);
        return;
      }
    }
  }

  /** Validate the whole draft and make it the live timetable — atomically, or not at all. */
  async publish(ctx: RequestContext, academicYearId: string): Promise<TimetableVersionView> {
    const id = await this.write(ctx, 'timetable.publish', async ({ repos, now, actor, audit }) => {
      const year = required(await repos.academicYears.find(academicYearId), 'academic year');
      editableYear(year);
      const draft = await repos.timetable.versionWithStatus(year.id, 'DRAFT');
      if (!draft) throw new ConflictError(`${year.label} has no draft timetable to publish.`);
      const frame = await loadFrame(repos, year);
      const entries = await repos.timetable.listEntries(draft.id);
      if (entries.length === 0) {
        throw new ConflictError('The draft has no lessons. Add lessons before publishing.');
      }
      const issues = await draftIssues(repos, frame, entries);
      if (issues.length > 0) {
        throw new ConflictError(
          `The timetable was not published: ${issues.length} lesson${issues.length === 1 ? ' needs' : 's need'} attention.`,
          undefined,
          issues.map((i) => ({ path: `entries.${i.entryId}`, message: i.message })),
        );
      }
      const previous = await repos.timetable.versionWithStatus(year.id, 'PUBLISHED');
      if (previous) await repos.timetable.markSuperseded(previous.id, now);
      await repos.timetable.markPublished(draft.id, actor.userId, now);
      const published = required(await repos.timetable.findVersion(draft.id), 'timetable');
      if (published.status !== 'PUBLISHED') {
        throw new ConflictError('The draft changed while publishing. Please try again.');
      }
      await audit({
        action: 'timetable.published',
        entityType: 'timetable_version',
        entityId: draft.id,
        before: previous
          ? { versionId: previous.id, versionNumber: previous.versionNumber, status: 'PUBLISHED' }
          : null,
        after: {
          academicYearId: year.id,
          academicYear: year.label,
          versionNumber: draft.versionNumber,
          lessons: entries.length,
          sections: new Set(entries.map((e) => e.sectionId)).size,
          publishedAt: now,
        },
      });
      return draft.id;
    });
    return toVersionView(required(await this.repos.timetable.findVersion(id), 'timetable'));
  }

  /** Throw away the unpublished draft (the published timetable is untouched). */
  async discardDraft(ctx: RequestContext, academicYearId: string): Promise<void> {
    await this.write(ctx, 'timetable.publish', async ({ repos, audit }) => {
      const year = required(await repos.academicYears.find(academicYearId), 'academic year');
      editableYear(year);
      const draft = await repos.timetable.versionWithStatus(year.id, 'DRAFT');
      if (!draft) throw new ConflictError(`${year.label} has no draft timetable.`);
      const frame = await loadFrame(repos, year);
      const entries = await repos.timetable.listEntries(draft.id);
      await repos.timetable.deleteEntries(draft.id);
      await repos.timetable.deleteDraft(draft.id);
      await audit({
        action: 'timetable.draft_discarded',
        entityType: 'timetable_version',
        entityId: draft.id,
        before: {
          academicYearId: year.id,
          academicYear: year.label,
          versionNumber: draft.versionNumber,
          lessons: entries.map((e) => describeEntry(frame, e)),
        },
      });
    });
  }
}
