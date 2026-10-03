import {
  PERMISSIONS,
  RecordStatus,
  isConfigurableRole,
  type AttendanceLockMode,
  type Permission,
  type RankScope,
} from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import type {
  AttendancePolicyRepository,
  CategoryRecord,
  CategoryRepository,
  ExamRecord,
  ExamRepository,
  ExamSubjectRecord,
  GradeSchemeRecord,
  GradeSchemeRepository,
  PermissionOverride,
  RatingLabelRecord,
  RatingLabelRepository,
  RolePermissionRepository,
} from '../../../../modules/config/config.repository.js';
import { newId } from '../../../../core/utils/clock.js';
import type {
  CategoriesTable,
  Database,
  ExamSubjectsTable,
  ExamsTable,
} from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { controlled, lowerEquals } from './structure.repositories.js';

const LOCK_MODES = new Set<string>(['MONTHLY_CUTOFF', 'NO_LOCK']);
const RANK_SCOPES = new Set<string>(['SECTION', 'CLASS']);

// ---------------------------------------------------------------------------
// Attendance policy
// ---------------------------------------------------------------------------

export class KyselyAttendancePolicyRepository implements AttendancePolicyRepository {
  constructor(private readonly db: Kysely<Database>) {}

  get() {
    return guard(async () => {
      const row = await this.db
        .selectFrom('attendance_policy')
        .selectAll()
        .where('id', '=', 'default')
        .executeTakeFirst();
      if (!row) return null;
      return {
        mode: controlled(
          { is: (v): v is AttendanceLockMode => LOCK_MODES.has(String(v)) },
          row.mode,
          'lock mode',
        ),
        cutoffDay: row.cutoff_day,
        updatedAt: row.updated_at,
      };
    });
  }

  save(policy: { mode: AttendanceLockMode; cutoffDay: number }, now: string) {
    return guard(async () => {
      const updated = await this.db
        .updateTable('attendance_policy')
        .set({ mode: policy.mode, cutoff_day: policy.cutoffDay, updated_at: now })
        .where('id', '=', 'default')
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) > 0) return;
      await this.db
        .insertInto('attendance_policy')
        .values({
          id: 'default',
          mode: policy.mode,
          cutoff_day: policy.cutoffDay,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }
}

// ---------------------------------------------------------------------------
// Grade scales
// ---------------------------------------------------------------------------

export class KyselyGradeSchemeRepository implements GradeSchemeRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private async withBands(
    rows: { id: string; name: string; status: string; updated_at: string }[],
  ): Promise<GradeSchemeRecord[]> {
    if (rows.length === 0) return [];
    const bands = await this.db
      .selectFrom('grade_bands')
      .selectAll()
      .where(
        'grade_scheme_id',
        'in',
        rows.map((r) => r.id),
      )
      .orderBy('min_bp', 'desc')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: controlled(RecordStatus, row.status, 'status'),
      updatedAt: row.updated_at,
      bands: bands
        .filter((b) => b.grade_scheme_id === row.id)
        .map((b) => ({ label: b.label, minBp: b.min_bp, remark: b.remark })),
    }));
  }

  list() {
    return guard(async () =>
      this.withBands(
        await this.db.selectFrom('grade_schemes').selectAll().orderBy('name').execute(),
      ),
    );
  }

  find(id: string) {
    return guard(
      async () =>
        (
          await this.withBands(
            await this.db.selectFrom('grade_schemes').selectAll().where('id', '=', id).execute(),
          )
        )[0] ?? null,
    );
  }

  findByName(name: string) {
    return guard(
      async () =>
        (
          await this.withBands(
            await this.db
              .selectFrom('grade_schemes')
              .selectAll()
              .where(lowerEquals('name', name))
              .execute(),
          )
        )[0] ?? null,
    );
  }

  save(record: Omit<GradeSchemeRecord, 'updatedAt'>, now: string, isNew: boolean) {
    return guard(async () => {
      if (isNew) {
        await this.db
          .insertInto('grade_schemes')
          .values({
            id: record.id,
            name: record.name,
            status: record.status,
            created_at: now,
            updated_at: now,
          })
          .execute();
      } else {
        await this.db
          .updateTable('grade_schemes')
          .set({ name: record.name, status: record.status, updated_at: now })
          .where('id', '=', record.id)
          .execute();
        await this.db.deleteFrom('grade_bands').where('grade_scheme_id', '=', record.id).execute();
      }
      await this.db
        .insertInto('grade_bands')
        .values(
          record.bands.map((b) => ({
            id: newId(),
            grade_scheme_id: record.id,
            label: b.label,
            min_bp: b.minBp,
            remark: b.remark,
          })),
        )
        .execute();
    });
  }

  delete(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('grade_bands').where('grade_scheme_id', '=', id).execute();
      await this.db.deleteFrom('grade_schemes').where('id', '=', id).execute();
    });
  }

  idsInUse() {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('exams')
        .select('grade_scheme_id as id')
        .where('grade_scheme_id', 'is not', null)
        .union(
          this.db
            .selectFrom('exam_subjects')
            .select('grade_scheme_id as id')
            .where('grade_scheme_id', 'is not', null),
        )
        .execute();
      return new Set(rows.map((r) => r.id).filter((id): id is string => id !== null));
    });
  }
}

// ---------------------------------------------------------------------------
// Exams & exam subjects
// ---------------------------------------------------------------------------

function toExam(row: ExamsTable): ExamRecord {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    weightageBp: row.weightage_bp,
    gradeSchemeId: row.grade_scheme_id,
    rankScope: controlled(
      { is: (v): v is RankScope => RANK_SCOPES.has(String(v)) },
      row.rank_scope,
      'rank scope',
    ),
    displayOrder: row.display_order,
    status: controlled(RecordStatus, row.status, 'status'),
  };
}

function toExamSubject(row: ExamSubjectsTable): ExamSubjectRecord {
  return {
    id: row.id,
    examId: row.exam_id,
    classId: row.class_id,
    subjectId: row.subject_id,
    theoryMax: row.theory_max,
    internalMax: row.internal_max,
    practicalMax: row.practical_max,
    passMarks: row.pass_marks,
    normalizedMax: row.normalized_max,
    includeInResult: row.include_in_result === 1,
    gradeSchemeId: row.grade_scheme_id,
  };
}

export class KyselyExamRepository implements ExamRepository {
  constructor(private readonly db: Kysely<Database>) {}

  listByYear(academicYearId: string) {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('exams')
        .selectAll()
        .where('academic_year_id', '=', academicYearId)
        .orderBy('display_order')
        .orderBy('start_date')
        .orderBy('name')
        .execute();
      const counts = await this.db
        .selectFrom('exam_subjects')
        .select(['exam_id', (eb) => eb.fn.countAll<number>().as('count')])
        .where('exam_id', 'in', rows.length ? rows.map((r) => r.id) : [''])
        .groupBy('exam_id')
        .execute();
      const byExam = new Map(counts.map((c) => [c.exam_id, Number(c.count)]));
      return rows.map((row) => ({ ...toExam(row), subjectCount: byExam.get(row.id) ?? 0 }));
    });
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('exams')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toExam(row) : null;
    });
  }

  findByName(academicYearId: string, name: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('exams')
        .selectAll()
        .where('academic_year_id', '=', academicYearId)
        .where(lowerEquals('name', name))
        .executeTakeFirst();
      return row ? toExam(row) : null;
    });
  }

  create(record: ExamRecord, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('exams')
        .values({
          id: record.id,
          academic_year_id: record.academicYearId,
          name: record.name,
          start_date: record.startDate,
          end_date: record.endDate,
          weightage_bp: record.weightageBp,
          grade_scheme_id: record.gradeSchemeId,
          rank_scope: record.rankScope,
          display_order: record.displayOrder,
          status: record.status,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  update(id: string, changes: Partial<Omit<ExamRecord, 'id' | 'academicYearId'>>, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('exams')
        .set({
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.startDate !== undefined ? { start_date: changes.startDate } : {}),
          ...(changes.endDate !== undefined ? { end_date: changes.endDate } : {}),
          ...(changes.weightageBp !== undefined ? { weightage_bp: changes.weightageBp } : {}),
          ...(changes.gradeSchemeId !== undefined
            ? { grade_scheme_id: changes.gradeSchemeId }
            : {}),
          ...(changes.rankScope !== undefined ? { rank_scope: changes.rankScope } : {}),
          ...(changes.displayOrder !== undefined ? { display_order: changes.displayOrder } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  delete(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('exams').where('id', '=', id).execute();
    });
  }

  countSubjects(examId: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('exam_subjects')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('exam_id', '=', examId)
        .executeTakeFirst();
      return Number(row?.count ?? 0);
    });
  }

  listSubjects(examId: string, classId: string) {
    return guard(async () =>
      (
        await this.db
          .selectFrom('exam_subjects')
          .selectAll()
          .where('exam_id', '=', examId)
          .where('class_id', '=', classId)
          .execute()
      ).map(toExamSubject),
    );
  }

  insertSubject(record: ExamSubjectRecord, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('exam_subjects')
        .values({
          id: record.id,
          exam_id: record.examId,
          class_id: record.classId,
          subject_id: record.subjectId,
          theory_max: record.theoryMax,
          internal_max: record.internalMax,
          practical_max: record.practicalMax,
          pass_marks: record.passMarks,
          normalized_max: record.normalizedMax,
          include_in_result: record.includeInResult ? 1 : 0,
          grade_scheme_id: record.gradeSchemeId,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateSubject(
    id: string,
    c: Omit<ExamSubjectRecord, 'id' | 'examId' | 'classId' | 'subjectId'>,
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .updateTable('exam_subjects')
        .set({
          theory_max: c.theoryMax,
          internal_max: c.internalMax,
          practical_max: c.practicalMax,
          pass_marks: c.passMarks,
          normalized_max: c.normalizedMax,
          include_in_result: c.includeInResult ? 1 : 0,
          grade_scheme_id: c.gradeSchemeId,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  deleteSubject(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('exam_subjects').where('id', '=', id).execute();
    });
  }
}

// ---------------------------------------------------------------------------
// Behaviour / achievement categories (same shape, different tables)
// ---------------------------------------------------------------------------

type CategoryTable = 'behaviour_categories' | 'achievement_categories';

function toCategory(row: CategoriesTable): CategoryRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    displayOrder: row.display_order,
    status: controlled(RecordStatus, row.status, 'status'),
  };
}

export class KyselyCategoryRepository implements CategoryRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly table: CategoryTable,
  ) {}

  list() {
    return guard(async () =>
      (
        await this.db
          .selectFrom(this.table)
          .selectAll()
          .orderBy('display_order')
          .orderBy('name')
          .execute()
      ).map(toCategory),
    );
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom(this.table)
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toCategory(row) : null;
    });
  }

  findByName(name: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom(this.table)
        .selectAll()
        .where(lowerEquals('name', name))
        .executeTakeFirst();
      return row ? toCategory(row) : null;
    });
  }

  create(record: CategoryRecord, now: string) {
    return guard(async () => {
      await this.db
        .insertInto(this.table)
        .values({
          id: record.id,
          name: record.name,
          description: record.description,
          display_order: record.displayOrder,
          status: record.status,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  update(id: string, changes: Partial<Omit<CategoryRecord, 'id'>>, now: string) {
    return guard(async () => {
      await this.db
        .updateTable(this.table)
        .set({
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.description !== undefined ? { description: changes.description } : {}),
          ...(changes.displayOrder !== undefined ? { display_order: changes.displayOrder } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }
}

export class KyselyRatingLabelRepository implements RatingLabelRepository {
  constructor(private readonly db: Kysely<Database>) {}

  list() {
    return guard(async () =>
      (
        await this.db.selectFrom('behaviour_rating_labels').selectAll().orderBy('rating').execute()
      ).map((r) => ({
        rating: r.rating,
        label: r.label,
        description: r.description,
      })),
    );
  }

  replaceAll(labels: RatingLabelRecord[], now: string) {
    return guard(async () => {
      await this.db.deleteFrom('behaviour_rating_labels').execute();
      await this.db
        .insertInto('behaviour_rating_labels')
        .values(
          labels.map((l) => ({
            rating: l.rating,
            label: l.label,
            description: l.description,
            updated_at: now,
          })),
        )
        .execute();
    });
  }
}

// ---------------------------------------------------------------------------
// Role permission overrides
// ---------------------------------------------------------------------------

const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);

export class KyselyRolePermissionRepository implements RolePermissionRepository {
  constructor(private readonly db: Kysely<Database>) {}

  list() {
    return guard(async () => {
      const rows = await this.db.selectFrom('role_permission_overrides').selectAll().execute();
      return rows.flatMap((r): PermissionOverride[] =>
        isConfigurableRole(r.role) &&
        KNOWN_PERMISSIONS.has(r.permission) &&
        (r.effect === 'GRANT' || r.effect === 'REVOKE')
          ? [{ role: r.role, permission: r.permission as Permission, effect: r.effect }]
          : [],
      );
    });
  }

  replaceForRole(
    role: PermissionOverride['role'],
    overrides: PermissionOverride[],
    updatedBy: string | null,
    now: string,
  ) {
    return guard(async () => {
      await this.db.deleteFrom('role_permission_overrides').where('role', '=', role).execute();
      if (overrides.length === 0) return;
      await this.db
        .insertInto('role_permission_overrides')
        .values(
          overrides.map((o) => ({
            role,
            permission: o.permission,
            effect: o.effect,
            updated_by: updatedBy,
            updated_at: now,
          })),
        )
        .execute();
    });
  }
}
