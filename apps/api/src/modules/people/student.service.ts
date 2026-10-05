import type {
  StudentAdmissionSchema,
  StudentDetailsSchema,
  StudentListQuerySchema,
  StudentPlacementSchema,
  StudentTransferSchema,
} from '@ttlmhss/shared';
import {
  usernameFromIdentifier,
  type RecordStatus,
  type StudentList,
  type StudentView,
  type TemporaryCredentialView,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import { ConflictError, ForbiddenError, fieldConflict } from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type { Repositories } from '../../data/data-store.js';
import type { StudentDetailsRecord, StudentRecord } from './people.repository.js';
import {
  PeopleService,
  checkRollNumber,
  dateWithin,
  openYear,
  required,
  toAccountView,
  toPlacementView,
  usableSection,
  type RequestContext,
} from './people-service.js';

type Details = z.output<typeof StudentDetailsSchema>;

const pickDetails = (d: Details): StudentDetailsRecord => ({
  fullName: d.fullName,
  dateOfBirth: d.dateOfBirth,
  gender: d.gender,
  fatherName: d.fatherName,
  motherName: d.motherName,
  guardianName: d.guardianName,
  guardianRelation: d.guardianRelation,
  guardianPhone: d.guardianPhone,
  phone: d.phone,
  email: d.email,
  emergencyPhone: d.emergencyPhone,
  address: d.address,
  city: d.city,
  state: d.state,
  pincode: d.pincode,
});

/** Username must be free; on conflict the message points at the field the admin can change. */
export async function availableUsername(
  repos: Repositories,
  requested: string | null,
  identifier: string,
) {
  const username = requested ?? usernameFromIdentifier(identifier);
  if (await repos.userAccounts.findByUsername(username)) {
    throw fieldConflict(
      'username',
      `The username "${username}" is already in use. Enter a different one.`,
    );
  }
  return username;
}

/**
 * Students (BR-ST): admission with account, details, academic placement (enrolments), mid-year
 * class/section changes, (re)activation and the narrowly allowed deletion. Promotion lives in
 * PromotionService.
 */
export class StudentService extends PeopleService {
  // ---- Reading ---------------------------------------------------------------------------------

  async list(
    ctx: RequestContext,
    input: z.output<typeof StudentListQuerySchema>,
  ): Promise<StudentList> {
    const principal = this.authorize(ctx, 'students.view');
    const repos = this.repos;
    const year = input.academicYearId
      ? required(await repos.academicYears.find(input.academicYearId), 'academic year')
      : await repos.academicYears.findCurrent();

    // Scope (BR-ST-03): administrators see everyone; a class teacher sees their own sections;
    // nobody else has a school-wide student list.
    let sectionIds: string[] | null = input.sectionId ? [input.sectionId] : null;
    if (!this.deps.authorization.isAdmin(principal)) {
      const own = principal.classTeacherOf
        .filter((s) => !year || s.academicYearId === year.id)
        .map((s) => s.sectionId);
      if (own.length === 0) throw new ForbiddenError('You do not have access to the student list.');
      sectionIds = sectionIds ? sectionIds.filter((id) => own.includes(id)) : own;
    }

    const { rows, total } = await repos.students.list({
      q: input.q?.trim() || null,
      academicYearId: year?.id ?? null,
      classId: input.classId ?? null,
      sectionIds,
      status: input.status,
      sort: input.sort,
      offset: (input.page - 1) * input.pageSize,
      limit: input.pageSize,
    });
    return {
      items: rows.map(({ student, placement }) => ({
        id: student.id,
        admissionNumber: student.admissionNumber,
        fullName: student.fullName,
        status: student.status,
        exitReason: student.exitReason,
        placement: placement ? toPlacementView(placement) : null,
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
      academicYearId: year?.id ?? null,
    };
  }

  async get(ctx: RequestContext, id: string): Promise<StudentView> {
    const principal = this.authorize(ctx, 'students.view');
    await this.deps.authorization.checkStudentScope(principal, id);
    const student = required(await this.repos.students.find(id), 'student');
    return this.view(student, this.deps.authorization.isAdmin(principal));
  }

  private async view(student: StudentRecord, admin: boolean): Promise<StudentView> {
    const repos = this.repos;
    const [history, current, account] = await Promise.all([
      repos.enrolments.listForStudent(student.id),
      repos.academicYears.findCurrent(),
      repos.personAccounts.find(student.userId),
    ]);
    const currentPlacement = current
      ? (history.find((p) => p.academicYearId === current.id && p.status === 'ACTIVE') ?? null)
      : null;
    const { userId: _userId, ...rest } = student;
    return {
      ...rest,
      current: currentPlacement ? toPlacementView(currentPlacement) : null,
      history: history.map(toPlacementView),
      account: toAccountView(account),
      deletable: admin && (await this.isDeletable(student, history.length)),
    };
  }

  /** BR-ST-10: only a record created by mistake — at most its admission placement, account never used. */
  private async isDeletable(student: StudentRecord, placements: number): Promise<boolean> {
    if (placements > 1) return false;
    if ((await this.repos.attendance.countForStudent(student.id)) > 0) return false;
    // Phase 8B/9 history: marks, behaviour assessments and achievements also keep a student.
    if ((await this.repos.marks.entriesForStudent(student.id)).length > 0) return false;
    if ((await this.repos.behaviour.assessmentsForStudent(student.id)).length > 0) return false;
    const achievements = await this.repos.achievements.list({
      academicYearId: null,
      sectionIds: null,
      studentId: student.id,
      categoryId: null,
      from: null,
      to: null,
      q: null,
      status: 'ALL',
      offset: 0,
      limit: 1,
    });
    if (achievements.total > 0) return false;
    return this.repos.personAccounts.isUnused(student.userId);
  }

  // ---- Admission -------------------------------------------------------------------------------

  /**
   * Admit a student: record + login account (role STUDENT, temporary password, must change it at
   * first sign-in) + first placement, all in one transaction. The temporary password is NOT
   * returned; the administrator issues one deliberately (issueTemporaryPassword) to hand over.
   */
  async admit(
    ctx: RequestContext,
    input: z.output<typeof StudentAdmissionSchema>,
  ): Promise<StudentView> {
    const studentId = newId();
    await this.write(ctx, 'students.create', async ({ repos, now, actor, audit }) => {
      if (await repos.students.findByAdmissionNumber(input.admissionNumber)) {
        throw fieldConflict(
          'admissionNumber',
          `Admission number ${input.admissionNumber} is already used by another student.`,
        );
      }
      const year = await openYear(repos, input.academicYearId, 'academicYearId');
      const section = await usableSection(repos, input.sectionId, 'sectionId');
      if (input.admissionDate > year.endDate) {
        throw fieldConflict(
          'admissionDate',
          `The admission date is after the end of ${year.label}.`,
        );
      }
      await checkRollNumber(
        repos,
        year.id,
        section.id,
        input.rollNumber,
        'rollNumber',
        section.label,
      );
      const username = await availableUsername(repos, input.username, input.admissionNumber);

      // Phase 2 account mechanism (hash only; the generated password is discarded here).
      const account = await this.deps.accounts.createAccount(
        { username, role: 'STUDENT' },
        actor,
        repos,
      );
      await repos.students.create(
        {
          id: studentId,
          userId: account.userId,
          admissionNumber: input.admissionNumber,
          admissionDate: input.admissionDate,
          ...pickDetails(input),
        },
        now,
      );
      const startedOn = input.admissionDate < year.startDate ? year.startDate : input.admissionDate;
      await repos.enrolments.create(
        {
          id: newId(),
          studentId,
          academicYearId: year.id,
          sectionId: section.id,
          rollNumber: input.rollNumber,
          startedOn,
          note: 'Admission',
          createdBy: actor.userId,
        },
        now,
      );
      await audit({
        action: 'student.admitted',
        entityType: 'student',
        entityId: studentId,
        after: {
          admissionNumber: input.admissionNumber,
          fullName: input.fullName,
          username,
          academicYear: year.label,
          section: section.label,
          rollNumber: input.rollNumber,
        },
      });
    });
    return this.get(ctx, studentId);
  }

  // ---- Details -----------------------------------------------------------------------------------

  async update(ctx: RequestContext, id: string, input: Details): Promise<StudentView> {
    const principal = this.authorize(ctx, 'students.edit');
    await this.deps.authorization.checkStudentScope(principal, id);
    await this.write(ctx, 'students.edit', async ({ repos, now, audit }) => {
      const before = required(await repos.students.find(id), 'student');
      const details = pickDetails(input);
      if (
        details.dateOfBirth &&
        before.admissionDate &&
        details.dateOfBirth >= before.admissionDate
      ) {
        throw fieldConflict('dateOfBirth', 'Date of birth must be before the admission date.');
      }
      await repos.students.updateDetails(id, details, now);
      const changed = Object.fromEntries(
        Object.entries(details).filter(([k, v]) => before[k as keyof StudentDetailsRecord] !== v),
      );
      await audit({
        action: 'student.updated',
        entityType: 'student',
        entityId: id,
        before: Object.fromEntries(
          Object.keys(changed).map((k) => [k, before[k as keyof StudentDetailsRecord]]),
        ),
        after: changed,
      });
    });
    return this.get(ctx, id);
  }

  // ---- Status --------------------------------------------------------------------------------------

  /**
   * Deactivate: the record, its history and the account are kept; the account can no longer sign in
   * and current sessions end. Reactivate: both become active again (a student who had left is back
   * on roll and can then be placed in a class).
   */
  async setStatus(
    ctx: RequestContext,
    id: string,
    status: RecordStatus,
    note: string | null,
  ): Promise<StudentView> {
    await this.write(ctx, 'students.deactivate', async ({ repos, now, audit }) => {
      const student = required(await repos.students.find(id), 'student');
      if (student.status === status && (status === 'INACTIVE' || !student.exitReason)) return;
      await repos.students.setStatus(id, status, null, now);
      await repos.userAccounts.setStatus(student.userId, status, now);
      const revoked =
        status === 'INACTIVE'
          ? await this.deps.sessions.revokeAllForUser(repos, student.userId, 'account_deactivated')
          : 0;
      await audit({
        action: status === 'INACTIVE' ? 'student.deactivated' : 'student.reactivated',
        entityType: 'student',
        entityId: id,
        before: { status: student.status, exitReason: student.exitReason },
        after: { status, accountStatus: status, sessionsEnded: revoked, note },
      });
    });
    return this.get(ctx, id);
  }

  // ---- Placement changes ------------------------------------------------------------------------

  /**
   * Mid-year class/section change (BR-ST-08): the current placement is CLOSED (status TRANSFERRED,
   * end date) and a new one is OPENED from the effective date. Nothing is overwritten.
   */
  async transfer(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof StudentTransferSchema>,
  ): Promise<StudentView> {
    await this.write(ctx, 'students.transfer', async ({ repos, now, actor, audit }) => {
      const student = required(await repos.students.find(id), 'student');
      if (student.status !== 'ACTIVE')
        throw new ConflictError(`${student.fullName} is inactive. Reactivate the student first.`);
      const year = input.academicYearId
        ? required(await repos.academicYears.find(input.academicYearId), 'academic year')
        : required(await repos.academicYears.findCurrent(), 'current academic year');
      const from = await repos.enrolments.findActive(id, year.id);
      if (!from)
        throw new ConflictError(`${student.fullName} has no class in ${year.label} to move from.`);
      if (year.status === 'CLOSED')
        throw new ConflictError(`${year.label} is closed; its history cannot be changed.`);
      const target = await usableSection(repos, input.targetSectionId, 'targetSectionId');
      if (target.id === from.sectionId) {
        throw fieldConflict(
          'targetSectionId',
          `${student.fullName} is already in ${target.label}.`,
        );
      }
      dateWithin(input.effectiveDate, year, 'effectiveDate');
      if (input.effectiveDate < from.startedOn) {
        throw fieldConflict(
          'effectiveDate',
          `The move cannot be before ${student.fullName} joined ${from.className} ${from.sectionName} (${from.startedOn}).`,
        );
      }
      await checkRollNumber(
        repos,
        year.id,
        target.id,
        input.rollNumber,
        'rollNumber',
        target.label,
      );

      await repos.enrolments.close(
        from.enrolmentId,
        {
          status: 'TRANSFERRED',
          endedOn: input.effectiveDate,
          closedBy: actor.userId,
          note: input.note,
        },
        now,
      );
      const toId = newId();
      await repos.enrolments.create(
        {
          id: toId,
          studentId: id,
          academicYearId: year.id,
          sectionId: target.id,
          rollNumber: input.rollNumber,
          startedOn: input.effectiveDate,
          note: input.note ?? `Moved from ${from.className} ${from.sectionName}`,
          createdBy: actor.userId,
        },
        now,
      );
      await audit({
        action: 'student.transferred',
        entityType: 'student',
        entityId: id,
        before: {
          enrolmentId: from.enrolmentId,
          section: `${from.className} ${from.sectionName}`,
          rollNumber: from.rollNumber,
        },
        after: {
          enrolmentId: toId,
          section: target.label,
          rollNumber: input.rollNumber,
          effectiveDate: input.effectiveDate,
          year: year.label,
        },
      });
    });
    return this.get(ctx, id);
  }

  /** Place an on-roll student who has no class in a year (re-admission, or missed promotion). */
  async place(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof StudentPlacementSchema>,
  ): Promise<StudentView> {
    await this.write(ctx, 'students.transfer', async ({ repos, now, actor, audit }) => {
      const student = required(await repos.students.find(id), 'student');
      if (student.status !== 'ACTIVE')
        throw new ConflictError(`${student.fullName} is inactive. Reactivate the student first.`);
      const year = await openYear(repos, input.academicYearId, 'academicYearId');
      const existing = await repos.enrolments.findActive(id, year.id);
      if (existing) {
        throw fieldConflict(
          'academicYearId',
          `${student.fullName} is already in ${existing.className} ${existing.sectionName} in ${year.label}. Use "Change class" instead.`,
        );
      }
      const section = await usableSection(repos, input.sectionId, 'sectionId');
      dateWithin(input.startedOn, year, 'startedOn');
      await checkRollNumber(
        repos,
        year.id,
        section.id,
        input.rollNumber,
        'rollNumber',
        section.label,
      );
      const enrolmentId = newId();
      await repos.enrolments.create(
        {
          id: enrolmentId,
          studentId: id,
          academicYearId: year.id,
          sectionId: section.id,
          rollNumber: input.rollNumber,
          startedOn: input.startedOn,
          note: 'Placed in class',
          createdBy: actor.userId,
        },
        now,
      );
      await audit({
        action: 'student.placed',
        entityType: 'student',
        entityId: id,
        after: {
          enrolmentId,
          year: year.label,
          section: section.label,
          rollNumber: input.rollNumber,
        },
      });
    });
    return this.get(ctx, id);
  }

  // ---- Deletion --------------------------------------------------------------------------------

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.write(ctx, 'students.delete', async ({ repos, audit }) => {
      const student = required(await repos.students.find(id), 'student');
      const placements = await repos.enrolments.countForStudent(id);
      if (
        placements > 1 ||
        (await repos.attendance.countForStudent(id)) > 0 ||
        !(await repos.personAccounts.isUnused(student.userId))
      ) {
        throw new ConflictError(
          `${student.fullName} already has school history (placements, attendance) or has used their account, so the record cannot be deleted. Deactivate it instead.`,
        );
      }
      await repos.enrolments.deleteForStudent(id);
      await repos.students.delete(id);
      await repos.personAccounts.delete(student.userId);
      const { userId: _u, ...snapshot } = student;
      await audit({
        action: 'student.deleted',
        entityType: 'student',
        entityId: id,
        before: snapshot,
      });
    });
  }

  // ---- Credentials -----------------------------------------------------------------------------

  /** New temporary password (shown once to the administrator; never stored or logged in plain text). */
  async issueTemporaryPassword(ctx: RequestContext, id: string): Promise<TemporaryCredentialView> {
    const principal = this.authorize(ctx, 'users.reset_password');
    const student = required(await this.repos.students.find(id), 'student');
    if (student.status !== 'ACTIVE') {
      throw new ConflictError(
        `${student.fullName} is inactive. Reactivate the student before issuing a password.`,
      );
    }
    const credential = await this.deps.accounts.issueTemporaryPassword(student.userId, principal);
    return { username: credential.username, temporaryPassword: credential.temporaryPassword };
  }
}
