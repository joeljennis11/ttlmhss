import { sql, type Kysely } from 'kysely';
import type {
  AchievementFilter,
  AchievementRecord,
  AchievementRepository,
  AchievementStatus,
  AchievementValues,
} from '../../../../modules/achievements/achievements.repository.js';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { likePattern } from '../people/student.repositories.js';

const nameOf = (column: string) =>
  sql<
    string | null
  >`(select coalesce(t.full_name, u.username) from users u left join teachers t on t.user_id = u.id where u.id = ${sql.ref(column)})`;

export class KyselyAchievementRepository implements AchievementRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private base() {
    return this.db
      .selectFrom('achievements as a')
      .innerJoin('academic_years as y', 'y.id', 'a.academic_year_id')
      .innerJoin('students as s', 's.id', 'a.student_id')
      .innerJoin('enrolments as e', 'e.id', 'a.enrolment_id')
      .innerJoin('sections as sec', 'sec.id', 'e.section_id')
      .innerJoin('classes as c', 'c.id', 'sec.class_id')
      .innerJoin('achievement_categories as cat', 'cat.id', 'a.category_id');
  }

  private columns() {
    return this.base().select([
      'a.id',
      'a.academic_year_id',
      'y.label as year_label',
      'y.status as year_status',
      'a.student_id',
      's.full_name',
      's.admission_number',
      'a.enrolment_id',
      'e.roll_number',
      'sec.id as section_id',
      'sec.name as section_name',
      'c.id as class_id',
      'c.name as class_name',
      'a.category_id',
      'cat.name as category_name',
      'a.title',
      'a.description',
      'a.achieved_on',
      'a.attachment_ref',
      'a.status',
      'a.updated_at',
      nameOf('a.created_by').as('created_by_name'),
    ]);
  }

  private toRecord(r: Record<string, unknown>): AchievementRecord {
    return {
      id: r.id as string,
      academicYearId: r.academic_year_id as string,
      yearLabel: r.year_label as string,
      yearStatus: r.year_status as string,
      studentId: r.student_id as string,
      fullName: r.full_name as string,
      admissionNumber: r.admission_number as string,
      enrolmentId: r.enrolment_id as string,
      rollNumber: (r.roll_number as string | null) ?? null,
      sectionId: r.section_id as string,
      sectionName: r.section_name as string,
      classId: r.class_id as string,
      className: r.class_name as string,
      categoryId: r.category_id as string,
      categoryName: r.category_name as string,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      achievedOn: r.achieved_on as string,
      attachmentRef: (r.attachment_ref as string | null) ?? null,
      status: r.status as AchievementStatus,
      createdByName: (r.created_by_name as string | null) ?? null,
      updatedAt: r.updated_at as string,
    };
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.columns().where('a.id', '=', id).executeTakeFirst();
      return row ? this.toRecord(row) : null;
    });
  }

  list(f: AchievementFilter) {
    return guard(async () => {
      let q = this.columns();
      if (f.academicYearId) q = q.where('a.academic_year_id', '=', f.academicYearId);
      if (f.sectionIds)
        q = q.where('e.section_id', 'in', f.sectionIds.length ? f.sectionIds : ['']);
      if (f.studentId) q = q.where('a.student_id', '=', f.studentId);
      if (f.categoryId) q = q.where('a.category_id', '=', f.categoryId);
      if (f.from) q = q.where('a.achieved_on', '>=', f.from);
      if (f.to) q = q.where('a.achieved_on', '<=', f.to);
      if (f.status !== 'ALL') q = q.where('a.status', '=', f.status);
      if (f.q) {
        const pattern = likePattern(f.q);
        q = q.where((eb) =>
          eb.or([
            eb(sql`lower(s.full_name)`, 'like', sql`${pattern} escape '\\'`),
            eb(sql`lower(s.admission_number)`, 'like', sql`${pattern} escape '\\'`),
            eb(sql`lower(a.title)`, 'like', sql`${pattern} escape '\\'`),
          ]),
        );
      }
      const total = await q
        .clearSelect()
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst();
      const rows = await q
        .orderBy('a.achieved_on', 'desc')
        .orderBy('s.full_name')
        .orderBy('a.id')
        .offset(f.offset)
        .limit(f.limit)
        .execute();
      return { rows: rows.map((r) => this.toRecord(r)), total: Number(total?.n ?? 0) };
    });
  }

  create(
    a: AchievementValues & {
      id: string;
      academicYearId: string;
      studentId: string;
      createdBy: string;
    },
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('achievements')
        .values({
          id: a.id,
          academic_year_id: a.academicYearId,
          student_id: a.studentId,
          enrolment_id: a.enrolmentId,
          category_id: a.categoryId,
          title: a.title,
          description: a.description,
          achieved_on: a.achievedOn,
          attachment_ref: null,
          status: 'ACTIVE',
          created_by: a.createdBy,
          updated_by: a.createdBy,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  update(id: string, v: AchievementValues, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('achievements')
        .set({
          category_id: v.categoryId,
          title: v.title,
          description: v.description,
          achieved_on: v.achievedOn,
          enrolment_id: v.enrolmentId,
          updated_by: actorUserId,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  setStatus(id: string, status: AchievementStatus, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('achievements')
        .set({ status, updated_by: actorUserId, updated_at: now })
        .where('id', '=', id)
        .execute();
    });
  }

  delete(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('achievements').where('id', '=', id).execute();
    });
  }
}
