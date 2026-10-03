import type {
  ClassTeacherAssignSchema,
  TeacherCreateSchema,
  TeacherDetailsSchema,
  TeacherListQuerySchema,
} from '@ttlmhss/shared';
import {
  type ClassTeacherAssignmentView,
  type ClassTeacherBoard,
  type RecordStatus,
  type TeacherList,
  type TeacherView,
  type TemporaryCredentialView,
} from '@ttlmhss/shared';
import type { z } from 'zod';
import { ConflictError, fieldConflict } from '../../core/errors/app-errors.js';
import { newId } from '../../core/utils/clock.js';
import type {
  ClassTeacherRecord,
  TeacherDetailsRecord,
  TeacherRecord,
} from './people.repository.js';
import {
  PeopleService,
  openYear,
  required,
  toAccountView,
  usableSection,
  type RequestContext,
} from './people-service.js';
import { availableUsername } from './student.service.js';

type Details = z.output<typeof TeacherDetailsSchema>;

const pickDetails = (d: Details): TeacherDetailsRecord => ({
  fullName: d.fullName,
  gender: d.gender,
  dateOfBirth: d.dateOfBirth,
  phone: d.phone,
  email: d.email,
  address: d.address,
  designation: d.designation,
  qualification: d.qualification,
  joiningDate: d.joiningDate,
});

export const toAssignmentView = (a: ClassTeacherRecord): ClassTeacherAssignmentView => ({ ...a });

/**
 * Teachers (BR-TCH): record + login account (role TEACHER), details, (de)activation, the Teacher →
 * Subject relationship and narrowly allowed deletion.
 *
 * Teacher → Subject is deliberately ONLY teacher + subject. Which classes a teacher teaches comes
 * from timetable assignments (Teacher + Subject + Class/Section + Day + Period) in Phase 6.
 */
export class TeacherService extends PeopleService {
  async list(
    ctx: RequestContext,
    input: z.output<typeof TeacherListQuerySchema>,
  ): Promise<TeacherList> {
    const principal = this.authorize(ctx, 'teachers.view');
    const repos = this.repos;
    const { rows, total } = await repos.teachers.list({
      q: input.q?.trim() || null,
      subjectId: input.subjectId ?? null,
      status: input.status,
      designation: input.designation?.trim() || null,
      offset: (input.page - 1) * input.pageSize,
      limit: input.pageSize,
    });
    const ids = rows.map((t) => t.id);
    const showSubjects = principal.permissions.has('teacher_subjects.view');
    const showClassTeachers = principal.permissions.has('class_teacher_assignments.view');
    const [subjects, current] = await Promise.all([
      showSubjects ? repos.teacherSubjects.forTeachers(ids) : Promise.resolve(new Map()),
      repos.academicYears.findCurrent(),
    ]);
    const assignments =
      current && showClassTeachers ? await repos.classTeachers.activeInYear(current.id, ids) : [];
    return {
      items: rows.map((t) => ({
        id: t.id,
        staffCode: t.staffCode,
        fullName: t.fullName,
        designation: t.designation,
        status: t.status,
        subjects: subjects.get(t.id) ?? [],
        classTeacherOf: assignments.filter((a) => a.teacherId === t.id).map(toAssignmentView),
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async designations(ctx: RequestContext): Promise<string[]> {
    this.authorize(ctx, 'teachers.view');
    return this.repos.teachers.designations();
  }

  async get(ctx: RequestContext, id: string): Promise<TeacherView> {
    const principal = this.authorize(ctx, 'teachers.view');
    const teacher = required(await this.repos.teachers.find(id), 'teacher');
    return this.view(teacher, this.deps.authorization.isAdmin(principal), principal.permissions);
  }

  private async view(
    teacher: TeacherRecord,
    admin: boolean,
    permissions: ReadonlySet<string>,
  ): Promise<TeacherView> {
    const repos = this.repos;
    const [subjects, assignments, account] = await Promise.all([
      permissions.has('teacher_subjects.view')
        ? repos.teacherSubjects.forTeachers([teacher.id])
        : Promise.resolve(new Map()),
      permissions.has('class_teacher_assignments.view')
        ? repos.classTeachers.forTeacher(teacher.id)
        : Promise.resolve([]),
      admin ? repos.personAccounts.find(teacher.userId) : Promise.resolve(null),
    ]);
    const { userId: _u, ...rest } = teacher;
    return {
      ...rest,
      subjects: subjects.get(teacher.id) ?? [],
      classTeacherAssignments: assignments.map(toAssignmentView),
      account: toAccountView(account),
      deletable: admin && (await this.isDeletable(teacher)),
    };
  }

  /** Only a record created by mistake: never class teacher, account never used. */
  private async isDeletable(teacher: TeacherRecord): Promise<boolean> {
    if ((await this.repos.classTeachers.countForTeacher(teacher.id)) > 0) return false;
    if ((await this.repos.timetable.countForTeacher(teacher.id)) > 0) return false;
    return this.repos.personAccounts.isUnused(teacher.userId);
  }

  async create(
    ctx: RequestContext,
    input: z.output<typeof TeacherCreateSchema>,
  ): Promise<TeacherView> {
    const id = newId();
    await this.write(ctx, 'teachers.create', async ({ repos, now, actor, audit }) => {
      if (await repos.teachers.findByStaffCode(input.staffCode)) {
        throw fieldConflict(
          'staffCode',
          `Staff ID ${input.staffCode} is already used by another teacher.`,
        );
      }
      const username = await availableUsername(repos, input.username, input.staffCode);
      // Role is always TEACHER: this workflow can never create an administrator.
      const account = await this.deps.accounts.createAccount(
        { username, role: 'TEACHER' },
        actor,
        repos,
      );
      await repos.teachers.create(
        { id, userId: account.userId, staffCode: input.staffCode, ...pickDetails(input) },
        now,
      );
      await audit({
        action: 'teacher.created',
        entityType: 'teacher',
        entityId: id,
        after: {
          staffCode: input.staffCode,
          fullName: input.fullName,
          username,
          designation: input.designation,
        },
      });
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, input: Details): Promise<TeacherView> {
    await this.write(ctx, 'teachers.edit', async ({ repos, now, audit }) => {
      const before = required(await repos.teachers.find(id), 'teacher');
      const details = pickDetails(input);
      await repos.teachers.updateDetails(id, details, now);
      const changed = Object.fromEntries(
        Object.entries(details).filter(([k, v]) => before[k as keyof TeacherDetailsRecord] !== v),
      );
      await audit({
        action: 'teacher.updated',
        entityType: 'teacher',
        entityId: id,
        before: Object.fromEntries(
          Object.keys(changed).map((k) => [k, before[k as keyof TeacherDetailsRecord]]),
        ),
        after: changed,
      });
    });
    return this.get(ctx, id);
  }

  /**
   * Deactivate: account can no longer sign in, sessions end, and any ACTIVE class-teacher
   * assignment ends today (a section must not keep an inactive class teacher). Subjects and history
   * are kept. Reactivate restores the record and account (class-teacher roles are re-assigned
   * deliberately).
   */
  async setStatus(ctx: RequestContext, id: string, status: RecordStatus): Promise<TeacherView> {
    await this.write(ctx, 'teachers.deactivate', async ({ repos, now, audit }) => {
      const teacher = required(await repos.teachers.find(id), 'teacher');
      if (teacher.status === status) return;
      await repos.teachers.setStatus(id, status, now);
      await repos.userAccounts.setStatus(teacher.userId, status, now);
      let revoked = 0;
      const ended: string[] = [];
      if (status === 'INACTIVE') {
        revoked = await this.deps.sessions.revokeAllForUser(
          repos,
          teacher.userId,
          'account_deactivated',
        );
        const today = this.today();
        for (const a of await repos.classTeachers.forTeacher(id)) {
          if (a.status !== 'ACTIVE') continue;
          await repos.classTeachers.end(a.id, today < a.assignedOn ? a.assignedOn : today, now);
          ended.push(`${a.academicYearLabel} ${a.className} ${a.sectionName}`);
        }
      }
      await audit({
        action: status === 'INACTIVE' ? 'teacher.deactivated' : 'teacher.reactivated',
        entityType: 'teacher',
        entityId: id,
        before: { status: teacher.status },
        after: {
          status,
          accountStatus: status,
          sessionsEnded: revoked,
          classTeacherAssignmentsEnded: ended,
        },
      });
    });
    return this.get(ctx, id);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.write(ctx, 'teachers.delete', async ({ repos, audit }) => {
      const teacher = required(await repos.teachers.find(id), 'teacher');
      if (
        (await repos.classTeachers.countForTeacher(id)) > 0 ||
        (await repos.timetable.countForTeacher(id)) > 0 ||
        !(await repos.personAccounts.isUnused(teacher.userId))
      ) {
        throw new ConflictError(
          `${teacher.fullName} already has history (class teacher assignments, timetable lessons or account use), so the record cannot be deleted. Deactivate it instead.`,
        );
      }
      const subjects = (await repos.teacherSubjects.forTeachers([id])).get(id) ?? [];
      await repos.teacherSubjects.deleteForTeacher(id);
      await repos.teachers.delete(id);
      await repos.personAccounts.delete(teacher.userId);
      const { userId: _u, ...snapshot } = teacher;
      await audit({
        action: 'teacher.deleted',
        entityType: 'teacher',
        entityId: id,
        before: { ...snapshot, subjects: subjects.map((s) => s.name) },
      });
    });
  }

  // ---- Teacher → Subject ---------------------------------------------------------------------

  async assignSubject(
    ctx: RequestContext,
    teacherId: string,
    subjectId: string,
  ): Promise<TeacherView> {
    await this.write(ctx, 'teacher_subjects.manage', async ({ repos, now, audit }) => {
      const teacher = required(await repos.teachers.find(teacherId), 'teacher');
      if (teacher.status !== 'ACTIVE') throw new ConflictError(`${teacher.fullName} is inactive.`);
      const subject = await repos.subjects.find(subjectId);
      if (!subject) throw fieldConflict('subjectId', 'That subject is not in the subject list.');
      if (subject.status !== 'ACTIVE')
        throw fieldConflict('subjectId', `${subject.name} is inactive and cannot be assigned.`);
      if (await repos.teacherSubjects.exists(teacherId, subjectId)) {
        throw fieldConflict('subjectId', `${teacher.fullName} already teaches ${subject.name}.`);
      }
      await repos.teacherSubjects.add(teacherId, subjectId, now);
      await audit({
        action: 'teacher.subject_assigned',
        entityType: 'teacher',
        entityId: teacherId,
        after: { subjectId, subject: subject.name },
      });
    });
    return this.get(ctx, teacherId);
  }

  async removeSubject(
    ctx: RequestContext,
    teacherId: string,
    subjectId: string,
  ): Promise<TeacherView> {
    await this.write(ctx, 'teacher_subjects.manage', async ({ repos, audit }) => {
      required(await repos.teachers.find(teacherId), 'teacher');
      if (!(await repos.teacherSubjects.exists(teacherId, subjectId))) {
        throw required(null, 'subject assignment');
      }
      const subject = await repos.subjects.find(subjectId);
      // BR-TT-02: the draft or live timetable still has this teacher teaching this subject.
      const lessons = await repos.timetable.countLiveForTeacherSubject(teacherId, subjectId);
      if (lessons > 0) {
        throw new ConflictError(
          `${subject?.name ?? 'This subject'} is in the timetable for this teacher (${lessons} lesson${lessons === 1 ? '' : 's'}). Change those lessons in the timetable first.`,
        );
      }
      await repos.teacherSubjects.remove(teacherId, subjectId);
      await audit({
        action: 'teacher.subject_removed',
        entityType: 'teacher',
        entityId: teacherId,
        before: { subjectId, subject: subject?.name ?? null },
      });
    });
    return this.get(ctx, teacherId);
  }

  async issueTemporaryPassword(ctx: RequestContext, id: string): Promise<TemporaryCredentialView> {
    const principal = this.authorize(ctx, 'users.reset_password');
    const teacher = required(await this.repos.teachers.find(id), 'teacher');
    if (teacher.status !== 'ACTIVE') {
      throw new ConflictError(
        `${teacher.fullName} is inactive. Reactivate the teacher before issuing a password.`,
      );
    }
    const credential = await this.deps.accounts.issueTemporaryPassword(teacher.userId, principal);
    return { username: credential.username, temporaryPassword: credential.temporaryPassword };
  }
}

/**
 * Class teacher assignments (BR-TCH-04): Teacher + Academic year + Class/Section. At most one ACTIVE
 * class teacher per section per year (database-enforced). A teacher MAY hold more than one section
 * (D-08 — not restricted until the school decides). Replacing a class teacher is a deliberate
 * reassignment: the old assignment is ended (kept as history) and a new one starts.
 * The Phase 2 principal derives Class Teacher scope from these rows on every request.
 */
export class ClassTeacherService extends PeopleService {
  async board(ctx: RequestContext, academicYearId: string): Promise<ClassTeacherBoard> {
    this.authorize(ctx, 'class_teacher_assignments.view');
    const repos = this.repos;
    required(await repos.academicYears.find(academicYearId), 'academic year');
    const [classes, sections, active] = await Promise.all([
      repos.classes.listClasses(),
      repos.classes.listSections(),
      repos.classTeachers.activeInYear(academicYearId),
    ]);
    const bySection = new Map(active.map((a) => [a.sectionId, a]));
    const rows = classes
      .filter((c) => c.status === 'ACTIVE')
      .flatMap((c) =>
        sections
          .filter((s) => s.classId === c.id && (s.status === 'ACTIVE' || bySection.has(s.id)))
          .map((s) => ({
            classId: c.id,
            className: c.name,
            sectionId: s.id,
            sectionName: s.name,
            assignment: bySection.has(s.id) ? toAssignmentView(bySection.get(s.id)!) : null,
          })),
      );
    return { academicYearId, rows };
  }

  async assign(
    ctx: RequestContext,
    input: z.output<typeof ClassTeacherAssignSchema>,
  ): Promise<ClassTeacherAssignmentView> {
    const id = newId();
    await this.write(ctx, 'class_teacher_assignments.manage', async ({ repos, now, audit }) => {
      const year = await openYear(repos, input.academicYearId, 'academicYearId');
      const section = await usableSection(repos, input.sectionId, 'sectionId');
      const teacher = await repos.teachers.find(input.teacherId);
      if (!teacher) throw fieldConflict('teacherId', 'That teacher was not found.');
      if (teacher.status !== 'ACTIVE')
        throw fieldConflict('teacherId', `${teacher.fullName} is inactive.`);

      const today = this.today();
      const assignedOn =
        today < year.startDate ? year.startDate : today > year.endDate ? year.endDate : today;
      const current = await repos.classTeachers.findActiveForSection(year.id, section.id);
      if (current?.teacherId === teacher.id) {
        throw fieldConflict(
          'teacherId',
          `${teacher.fullName} is already class teacher of ${section.label} in ${year.label}.`,
        );
      }
      if (current && !input.replace) {
        throw fieldConflict(
          'teacherId',
          `${current.teacherName} is already class teacher of ${section.label} in ${year.label}. Choose to replace them to reassign.`,
        );
      }
      if (current)
        await repos.classTeachers.end(
          current.id,
          assignedOn < current.assignedOn ? current.assignedOn : assignedOn,
          now,
        );
      await repos.classTeachers.create(
        { id, teacherId: teacher.id, academicYearId: year.id, sectionId: section.id, assignedOn },
        now,
      );
      await audit({
        action: current ? 'class_teacher.reassigned' : 'class_teacher.assigned',
        entityType: 'class_teacher_assignment',
        entityId: id,
        before: current ? { assignmentId: current.id, teacher: current.teacherName } : null,
        after: {
          teacher: teacher.fullName,
          teacherId: teacher.id,
          year: year.label,
          section: section.label,
          assignedOn,
        },
      });
    });
    return toAssignmentView(required(await this.repos.classTeachers.find(id), 'assignment'));
  }

  async end(ctx: RequestContext, id: string): Promise<ClassTeacherAssignmentView> {
    await this.write(ctx, 'class_teacher_assignments.manage', async ({ repos, now, audit }) => {
      const assignment = required(await repos.classTeachers.find(id), 'class teacher assignment');
      if (assignment.status !== 'ACTIVE')
        throw new ConflictError('This assignment has already ended.');
      const today = this.today();
      const endedOn = today < assignment.assignedOn ? assignment.assignedOn : today;
      await repos.classTeachers.end(id, endedOn, now);
      await audit({
        action: 'class_teacher.ended',
        entityType: 'class_teacher_assignment',
        entityId: id,
        before: {
          teacher: assignment.teacherName,
          section: `${assignment.className} ${assignment.sectionName}`,
          year: assignment.academicYearLabel,
        },
        after: { endedOn },
      });
    });
    return toAssignmentView(required(await this.repos.classTeachers.find(id), 'assignment'));
  }
}
