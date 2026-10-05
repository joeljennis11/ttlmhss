import { sql, type Kysely } from 'kysely';
import type {
  BehaviourAssessmentRecord,
  BehaviourRepository,
  BehaviourSheetRecord,
  BehaviourSheetStatus,
} from '../../../../modules/behaviour/behaviour.repository.js';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';

const nameOf = (column: string) =>
  sql<
    string | null
  >`(select coalesce(t.full_name, u.username) from users u left join teachers t on t.user_id = u.id where u.id = ${sql.ref(column)})`;

const STATUSES = new Set<BehaviourSheetStatus>(['DRAFT', 'SUBMITTED']);

export class KyselyBehaviourRepository implements BehaviourRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private sheets() {
    return this.db
      .selectFrom('behaviour_sheets')
      .selectAll('behaviour_sheets')
      .select(nameOf('behaviour_sheets.submitted_by').as('submitted_by_name'));
  }

  private toSheet(r: {
    id: string;
    academic_year_id: string;
    exam_id: string;
    class_id: string;
    section_id: string;
    status: string;
    revision: number;
    submitted_at: string | null;
    submitted_by_name: string | null;
    updated_at: string;
  }): BehaviourSheetRecord {
    if (!STATUSES.has(r.status as BehaviourSheetStatus))
      throw new Error(`Unexpected behaviour sheet status ${r.status}`);
    return {
      id: r.id,
      academicYearId: r.academic_year_id,
      examId: r.exam_id,
      classId: r.class_id,
      sectionId: r.section_id,
      status: r.status as BehaviourSheetStatus,
      revision: Number(r.revision),
      submittedAt: r.submitted_at,
      submittedByName: r.submitted_by_name,
      updatedAt: r.updated_at,
    };
  }

  findSheet(examId: string, sectionId: string) {
    return guard(async () => {
      const row = await this.sheets()
        .where('exam_id', '=', examId)
        .where('section_id', '=', sectionId)
        .executeTakeFirst();
      return row ? this.toSheet(row) : null;
    });
  }

  findSheetById(id: string) {
    return guard(async () => {
      const row = await this.sheets().where('id', '=', id).executeTakeFirst();
      return row ? this.toSheet(row) : null;
    });
  }

  createSheet(
    s: {
      id: string;
      academicYearId: string;
      examId: string;
      classId: string;
      sectionId: string;
      createdBy: string;
    },
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('behaviour_sheets')
        .values({
          id: s.id,
          academic_year_id: s.academicYearId,
          exam_id: s.examId,
          class_id: s.classId,
          section_id: s.sectionId,
          status: 'DRAFT',
          revision: 1,
          submitted_at: null,
          submitted_by: null,
          created_by: s.createdBy,
          updated_by: s.createdBy,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  claimRevision(id: string, expected: number, actorUserId: string, now: string) {
    return guard(async () => {
      const result = await this.db
        .updateTable('behaviour_sheets')
        .set((eb) => ({
          revision: eb('revision', '+', 1),
          updated_by: actorUserId,
          updated_at: now,
        }))
        .where('id', '=', id)
        .where('revision', '=', expected)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    });
  }

  markSubmitted(id: string, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('behaviour_sheets')
        .set((eb) => ({
          status: 'SUBMITTED',
          submitted_at: now,
          submitted_by: actorUserId,
          revision: eb('revision', '+', 1),
          updated_by: actorUserId,
          updated_at: now,
        }))
        .where('id', '=', id)
        .execute();
    });
  }

  private async withRatings(
    rows: {
      id: string;
      sheet_id: string;
      academic_year_id: string;
      section_id: string;
      enrolment_id: string;
      student_id: string;
      remark: string | null;
      updated_at: string;
    }[],
  ): Promise<BehaviourAssessmentRecord[]> {
    const ids = rows.map((r) => r.id);
    const ratings = ids.length
      ? await this.db
          .selectFrom('behaviour_ratings')
          .selectAll()
          .where('assessment_id', 'in', ids)
          .execute()
      : [];
    const byAssessment = new Map<string, BehaviourAssessmentRecord['ratings']>();
    for (const r of ratings) {
      const list = byAssessment.get(r.assessment_id) ?? [];
      list.push({ categoryId: r.category_id, rating: Number(r.rating), label: r.rating_label });
      byAssessment.set(r.assessment_id, list);
    }
    return rows.map((r) => ({
      id: r.id,
      sheetId: r.sheet_id,
      academicYearId: r.academic_year_id,
      sectionId: r.section_id,
      enrolmentId: r.enrolment_id,
      studentId: r.student_id,
      remark: r.remark,
      ratings: byAssessment.get(r.id) ?? [],
      updatedAt: r.updated_at,
    }));
  }

  assessmentsForSheet(sheetId: string) {
    return guard(async () =>
      this.withRatings(
        await this.db
          .selectFrom('behaviour_assessments')
          .selectAll()
          .where('sheet_id', '=', sheetId)
          .execute(),
      ),
    );
  }

  assessmentsForStudent(studentId: string) {
    return guard(async () =>
      this.withRatings(
        await this.db
          .selectFrom('behaviour_assessments')
          .selectAll()
          .where('student_id', '=', studentId)
          .execute(),
      ),
    );
  }

  insertAssessment(
    a: {
      id: string;
      sheetId: string;
      academicYearId: string;
      sectionId: string;
      enrolmentId: string;
      studentId: string;
      remark: string | null;
      createdBy: string;
    },
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('behaviour_assessments')
        .values({
          id: a.id,
          sheet_id: a.sheetId,
          academic_year_id: a.academicYearId,
          section_id: a.sectionId,
          enrolment_id: a.enrolmentId,
          student_id: a.studentId,
          remark: a.remark,
          created_by: a.createdBy,
          updated_by: a.createdBy,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateRemark(id: string, remark: string | null, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('behaviour_assessments')
        .set({ remark, updated_by: actorUserId, updated_at: now })
        .where('id', '=', id)
        .execute();
    });
  }

  setRating(
    assessmentId: string,
    categoryId: string,
    rating: number,
    label: string | null,
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('behaviour_ratings')
        .values({
          assessment_id: assessmentId,
          category_id: categoryId,
          rating,
          rating_label: label,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc
            .columns(['assessment_id', 'category_id'])
            .doUpdateSet({ rating, rating_label: label, updated_at: now }),
        )
        .execute();
    });
  }

  deleteRating(assessmentId: string, categoryId: string) {
    return guard(async () => {
      await this.db
        .deleteFrom('behaviour_ratings')
        .where('assessment_id', '=', assessmentId)
        .where('category_id', '=', categoryId)
        .execute();
    });
  }
}
