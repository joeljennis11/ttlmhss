import type { PortalProfileView } from '@ttlmhss/shared';
import { ForbiddenError, NotFoundError } from '../../core/errors/app-errors.js';
import { MarksServiceBase, type RequestContext } from '../marks/marks-context.js';
import { toPlacementView } from '../people/people-service.js';

/**
 * Student portal (Phase 9): the signed-in student's own read-only profile. The student id always
 * comes from the session (principal.studentId), never from the request. Administrative metadata
 * (exit reasons, record flags, audit, credentials) is not part of this view.
 */
export class PortalService extends MarksServiceBase {
  async profile(ctx: RequestContext): Promise<PortalProfileView> {
    const p = this.authorize(ctx, 'students.view');
    if (!p.studentId) throw new ForbiddenError('The student portal is for students.');
    const repos = this.repos;
    const student = await repos.students.find(p.studentId);
    if (!student) throw new NotFoundError('Your student record was not found.');
    const [history, currentYear, account] = await Promise.all([
      repos.enrolments.listForStudent(student.id),
      repos.academicYears.findCurrent(),
      repos.personAccounts.find(student.userId),
    ]);
    const current = currentYear
      ? (history.find((h) => h.academicYearId === currentYear.id && h.status === 'ACTIVE') ?? null)
      : null;
    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        admissionDate: student.admissionDate,
        dateOfBirth: student.dateOfBirth,
        gender: student.gender,
        fatherName: student.fatherName,
        motherName: student.motherName,
        guardianName: student.guardianName,
        guardianRelation: student.guardianRelation,
        guardianPhone: student.guardianPhone,
        phone: student.phone,
        email: student.email,
        address: student.address,
        city: student.city,
        state: student.state,
        pincode: student.pincode,
        status: student.status,
      },
      account: { username: account?.username ?? p.username, status: account?.status ?? 'ACTIVE' },
      currentYear: currentYear
        ? { id: currentYear.id, label: currentYear.label, status: currentYear.status }
        : null,
      current: current ? toPlacementView(current) : null,
      history: history.map(toPlacementView),
    };
  }
}
