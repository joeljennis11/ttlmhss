import type { ScopeRef } from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import type { AuthScopeRepository } from '../../../core/auth/scope.repository.js';
import type { Database } from '../database-schema.js';
import { guard } from '../db-errors.js';

export class KyselyAuthScopeRepository implements AuthScopeRepository {
  constructor(private readonly db: Kysely<Database>) {}

  classTeacherSections(teacherId: string): Promise<ScopeRef[]> {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('class_teacher_assignments as cta')
        .innerJoin('academic_years as ay', 'ay.id', 'cta.academic_year_id')
        .select(['cta.academic_year_id', 'cta.section_id'])
        .where('cta.teacher_id', '=', teacherId)
        .where('cta.status', '=', 'ACTIVE')
        .where('ay.status', '=', 'CURRENT')
        .orderBy('cta.section_id')
        .execute();
      return rows.map((r) => ({ academicYearId: r.academic_year_id, sectionId: r.section_id }));
    });
  }

  studentSections(studentId: string): Promise<ScopeRef[]> {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('enrolments as e')
        .innerJoin('academic_years as ay', 'ay.id', 'e.academic_year_id')
        .select(['e.academic_year_id', 'e.section_id'])
        .where('e.student_id', '=', studentId)
        .where('e.status', '=', 'ACTIVE')
        .where('ay.status', '=', 'CURRENT')
        .execute();
      return rows.map((r) => ({ academicYearId: r.academic_year_id, sectionId: r.section_id }));
    });
  }
}
