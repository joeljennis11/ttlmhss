import type { PromotionRequestSchema } from '@ttlmhss/shared';
import {
  CONTINUING_OUTCOMES,
  type PromotionCandidate,
  type PromotionResult,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import { fieldConflict } from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import {
  PeopleService,
  openYear,
  required,
  toPlacementView,
  usableSection,
  type RequestContext,
} from './people-service.js';

/**
 * Year-end promotion (BR-ST-05, BR-ST-09). Each student in the source class/section gets an
 * individual outcome:
 *   PROMOTED / NOT_PROMOTED → the source placement is closed with that status and a NEW placement is
 *                             opened in the target year (promoted: usually the next class; not
 *                             promoted: usually the same class again);
 *   TRANSFERRED / LEFT      → the placement is closed; the student goes off roll (record and account
 *                             deactivated, sessions ended) with the reason kept.
 * Everything runs in one transaction: if any student fails a check, no student is changed.
 */
export class PromotionService extends PeopleService {
  async candidates(
    ctx: RequestContext,
    input: {
      sourceAcademicYearId: string;
      sourceSectionId: string;
      targetAcademicYearId?: string | undefined;
    },
  ): Promise<PromotionCandidate[]> {
    this.authorize(ctx, 'students.promote');
    const repos = this.repos;
    required(await repos.academicYears.find(input.sourceAcademicYearId), 'academic year');
    required(await repos.classes.findSection(input.sourceSectionId), 'section');
    const rows = await repos.enrolments.listActiveInSection(
      input.sourceAcademicYearId,
      input.sourceSectionId,
    );
    const placed = input.targetAcademicYearId
      ? await repos.enrolments.placementsInYear(
          rows.map((r) => r.studentId),
          input.targetAcademicYearId,
        )
      : new Map();
    return rows.map((r) => {
      const target = placed.get(r.studentId);
      return {
        studentId: r.studentId,
        admissionNumber: r.admissionNumber,
        fullName: r.fullName,
        rollNumber: r.rollNumber,
        targetPlacement: target ? toPlacementView(target) : null,
      };
    });
  }

  async promote(
    ctx: RequestContext,
    input: z.output<typeof PromotionRequestSchema>,
  ): Promise<PromotionResult> {
    const result: PromotionResult = { promoted: 0, notPromoted: 0, transferred: 0, left: 0 };
    await this.write(ctx, 'students.promote', async ({ repos, now, actor, audit }) => {
      const source = required(
        await repos.academicYears.find(input.sourceAcademicYearId),
        'academic year',
      );
      const target = input.targetAcademicYearId
        ? await openYear(repos, input.targetAcademicYearId, 'targetAcademicYearId')
        : null;
      if (target && target.startDate <= source.startDate) {
        throw fieldConflict(
          'targetAcademicYearId',
          `Promote into a later year than ${source.label}.`,
        );
      }
      const sourceSection = await repos.classes.findSection(input.sourceSectionId);
      if (!sourceSection)
        throw fieldConflict('sourceSectionId', 'That class and section was not found.');
      const sourceClass = required(await repos.classes.findClass(sourceSection.classId), 'class');
      const sourceLabel = `${sourceClass.name} ${sourceSection.name}`;
      // Leaving dates: today if it falls inside the source year, otherwise the year's last day.
      const today = this.today();
      const leftOn = today >= source.startDate && today <= source.endDate ? today : source.endDate;
      const rollsUsed = new Map<string, Set<string>>();

      for (const [i, decision] of input.decisions.entries()) {
        const at = (field: string) => `decisions.${i}.${field}`;
        const student = required(await repos.students.find(decision.studentId), 'student');
        const from = await repos.enrolments.findActive(student.id, source.id);
        if (!from || from.sectionId !== sourceSection.id) {
          throw fieldConflict(
            at('studentId'),
            `${student.fullName} is not currently in ${sourceLabel} in ${source.label}.`,
          );
        }

        if (CONTINUING_OUTCOMES.includes(decision.outcome)) {
          if (!target)
            throw fieldConflict('targetAcademicYearId', 'Choose the year to promote into.');
          const already = await repos.enrolments.findActive(student.id, target.id);
          if (already) {
            throw fieldConflict(
              at('studentId'),
              `${student.fullName} is already placed in ${already.className} ${already.sectionName} for ${target.label}.`,
            );
          }
          const section = await usableSection(
            repos,
            decision.targetSectionId!,
            at('targetSectionId'),
          );
          if (decision.rollNumber) {
            const used = rollsUsed.get(section.id) ?? new Set<string>();
            const key = decision.rollNumber.toLowerCase();
            if (
              used.has(key) ||
              (await repos.enrolments.rollNumberTaken(target.id, section.id, decision.rollNumber))
            ) {
              throw fieldConflict(
                at('rollNumber'),
                `Roll number ${decision.rollNumber} is already used in ${section.label}.`,
              );
            }
            used.add(key);
            rollsUsed.set(section.id, used);
          }
          await repos.enrolments.close(
            from.enrolmentId,
            {
              status: decision.outcome,
              endedOn: source.endDate,
              closedBy: actor.userId,
              note: null,
            },
            now,
          );
          const enrolmentId = newId();
          await repos.enrolments.create(
            {
              id: enrolmentId,
              studentId: student.id,
              academicYearId: target.id,
              sectionId: section.id,
              rollNumber: decision.rollNumber,
              startedOn: target.startDate,
              note:
                decision.outcome === 'PROMOTED'
                  ? `Promoted from ${sourceLabel}`
                  : `Not promoted (was ${sourceLabel})`,
              createdBy: actor.userId,
            },
            now,
          );
          await audit({
            action: 'student.promotion',
            entityType: 'student',
            entityId: student.id,
            before: { year: source.label, section: sourceLabel, enrolmentId: from.enrolmentId },
            after: {
              outcome: decision.outcome,
              year: target.label,
              section: section.label,
              rollNumber: decision.rollNumber,
              enrolmentId,
            },
          });
          if (decision.outcome === 'PROMOTED') result.promoted++;
          else result.notPromoted++;
        } else {
          const reason = decision.outcome === 'TRANSFERRED' ? 'TRANSFERRED' : 'LEFT';
          const endedOn = leftOn < from.startedOn ? from.startedOn : leftOn;
          await repos.enrolments.close(
            from.enrolmentId,
            { status: decision.outcome, endedOn, closedBy: actor.userId, note: null },
            now,
          );
          await repos.students.setStatus(student.id, 'INACTIVE', { reason, date: endedOn }, now);
          await repos.userAccounts.setStatus(student.userId, 'INACTIVE', now);
          await this.deps.sessions.revokeAllForUser(repos, student.userId, 'account_deactivated');
          await audit({
            action: 'student.promotion',
            entityType: 'student',
            entityId: student.id,
            before: {
              year: source.label,
              section: sourceLabel,
              enrolmentId: from.enrolmentId,
              status: 'ACTIVE',
            },
            after: {
              outcome: decision.outcome,
              leftOn: endedOn,
              status: 'INACTIVE',
              accountStatus: 'INACTIVE',
            },
          });
          if (decision.outcome === 'TRANSFERRED') result.transferred++;
          else result.left++;
        }
      }

      await audit({
        action: 'students.promotion_completed',
        entityType: 'section',
        entityId: sourceSection.id,
        after: { from: `${source.label} ${sourceLabel}`, into: target?.label ?? null, ...result },
      });
    });
    return result;
  }
}
