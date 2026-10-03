import { AcademicYearStatus, PeriodKind, RecordStatus, Weekday } from '@ttlmhss/shared';
import { sql, type Kysely } from 'kysely';
import { InternalError } from '../../../../core/errors/app-errors.js';
import type {
  AcademicYearRecord,
  AcademicYearRepository,
  ClassRecord,
  ClassRepository,
  PeriodRecord,
  PeriodRepository,
  SectionRecord,
  SubjectRecord,
  SubjectRepository,
} from '../../../../modules/config/config.repository.js';
import type { AcademicYearsTable, Database, PeriodsTable } from '../../database-schema.js';
import { guard } from '../../db-errors.js';

/** Narrow a stored controlled value; a mismatch means corrupted data. */
export function controlled<T extends string>(
  set: { is(v: unknown): v is T },
  value: string,
  field: string,
): T {
  if (!set.is(value)) throw new InternalError(`Unexpected ${field} value in database`);
  return value;
}

/** Case-insensitive equality on a name/label column. */
export const lowerEquals = (column: string, value: string) =>
  sql<boolean>`lower(${sql.ref(column)}) = ${value.toLowerCase()}`;

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------

function toYear(row: AcademicYearsTable): AcademicYearRecord {
  return {
    id: row.id,
    label: row.label,
    startDate: row.start_date,
    endDate: row.end_date,
    status: controlled(AcademicYearStatus, row.status, 'academic year status'),
    workingDays: row.working_days
      ? row.working_days.split(',').map((d) => controlled(Weekday, d, 'weekday'))
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyAcademicYearRepository implements AcademicYearRepository {
  constructor(private readonly db: Kysely<Database>) {}

  list() {
    return guard(async () =>
      (
        await this.db
          .selectFrom('academic_years')
          .selectAll()
          .orderBy('start_date', 'desc')
          .execute()
      ).map(toYear),
    );
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('academic_years')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toYear(row) : null;
    });
  }

  findByLabel(label: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('academic_years')
        .selectAll()
        .where(lowerEquals('label', label))
        .executeTakeFirst();
      return row ? toYear(row) : null;
    });
  }

  findCurrent() {
    return guard(async () => {
      const row = await this.db
        .selectFrom('academic_years')
        .selectAll()
        .where('status', '=', 'CURRENT')
        .executeTakeFirst();
      return row ? toYear(row) : null;
    });
  }

  create(record: AcademicYearRecord) {
    return guard(async () => {
      await this.db
        .insertInto('academic_years')
        .values({
          id: record.id,
          label: record.label,
          start_date: record.startDate,
          end_date: record.endDate,
          status: record.status,
          working_days: record.workingDays?.join(',') ?? null,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
        })
        .execute();
    });
  }

  update(id: string, changes: Parameters<AcademicYearRepository['update']>[1], now: string) {
    return guard(async () => {
      await this.db
        .updateTable('academic_years')
        .set({
          ...(changes.label !== undefined ? { label: changes.label } : {}),
          ...(changes.startDate !== undefined ? { start_date: changes.startDate } : {}),
          ...(changes.endDate !== undefined ? { end_date: changes.endDate } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          ...(changes.workingDays !== undefined
            ? { working_days: changes.workingDays?.join(',') ?? null }
            : {}),
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  delete(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('academic_years').where('id', '=', id).execute();
    });
  }

  idsInUse() {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('periods')
        .select('academic_year_id as id')
        .union(this.db.selectFrom('exams').select('academic_year_id as id'))
        .union(this.db.selectFrom('enrolments').select('academic_year_id as id'))
        .union(this.db.selectFrom('class_teacher_assignments').select('academic_year_id as id'))
        .execute();
      return new Set(rows.map((r) => r.id));
    });
  }
}

// ---------------------------------------------------------------------------
// Classes & sections
// ---------------------------------------------------------------------------

export class KyselyClassRepository implements ClassRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private toClass = (row: {
    id: string;
    name: string;
    display_order: number;
    status: string;
  }): ClassRecord => ({
    id: row.id,
    name: row.name,
    displayOrder: row.display_order,
    status: controlled(RecordStatus, row.status, 'status'),
  });

  private toSection = (row: {
    id: string;
    class_id: string;
    name: string;
    status: string;
  }): SectionRecord => ({
    id: row.id,
    classId: row.class_id,
    name: row.name,
    status: controlled(RecordStatus, row.status, 'status'),
  });

  listClasses() {
    return guard(async () =>
      (
        await this.db
          .selectFrom('classes')
          .selectAll()
          .orderBy('display_order')
          .orderBy('name')
          .execute()
      ).map(this.toClass),
    );
  }

  listSections() {
    return guard(async () =>
      (await this.db.selectFrom('sections').selectAll().orderBy('name').execute()).map(
        this.toSection,
      ),
    );
  }

  findClass(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('classes')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? this.toClass(row) : null;
    });
  }

  findClassByName(name: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('classes')
        .selectAll()
        .where(lowerEquals('name', name))
        .executeTakeFirst();
      return row ? this.toClass(row) : null;
    });
  }

  createClass(record: ClassRecord, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('classes')
        .values({
          id: record.id,
          name: record.name,
          display_order: record.displayOrder,
          status: record.status,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateClass(id: string, changes: Partial<Omit<ClassRecord, 'id'>>, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('classes')
        .set({
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.displayOrder !== undefined ? { display_order: changes.displayOrder } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  findSection(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('sections')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? this.toSection(row) : null;
    });
  }

  findSectionByName(classId: string, name: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('sections')
        .selectAll()
        .where('class_id', '=', classId)
        .where(lowerEquals('name', name))
        .executeTakeFirst();
      return row ? this.toSection(row) : null;
    });
  }

  createSection(record: SectionRecord, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('sections')
        .values({
          id: record.id,
          class_id: record.classId,
          name: record.name,
          status: record.status,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateSection(id: string, changes: Partial<Pick<SectionRecord, 'name' | 'status'>>, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('sections')
        .set({
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export class KyselySubjectRepository implements SubjectRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private toSubject = (row: {
    id: string;
    name: string;
    code: string | null;
    display_order: number;
    status: string;
  }): SubjectRecord => ({
    id: row.id,
    name: row.name,
    code: row.code,
    displayOrder: row.display_order,
    status: controlled(RecordStatus, row.status, 'status'),
  });

  list() {
    return guard(async () =>
      (
        await this.db
          .selectFrom('subjects')
          .selectAll()
          .orderBy('display_order')
          .orderBy('name')
          .execute()
      ).map(this.toSubject),
    );
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('subjects')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? this.toSubject(row) : null;
    });
  }

  findByName(name: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('subjects')
        .selectAll()
        .where(lowerEquals('name', name))
        .executeTakeFirst();
      return row ? this.toSubject(row) : null;
    });
  }

  findByCode(code: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('subjects')
        .selectAll()
        .where('code', '=', code)
        .executeTakeFirst();
      return row ? this.toSubject(row) : null;
    });
  }

  create(record: SubjectRecord, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('subjects')
        .values({
          id: record.id,
          name: record.name,
          code: record.code,
          display_order: record.displayOrder,
          status: record.status,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  update(id: string, changes: Partial<Omit<SubjectRecord, 'id'>>, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('subjects')
        .set({
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.code !== undefined ? { code: changes.code } : {}),
          ...(changes.displayOrder !== undefined ? { display_order: changes.displayOrder } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }
}

// ---------------------------------------------------------------------------
// Periods & breaks
// ---------------------------------------------------------------------------

function toPeriod(row: PeriodsTable): PeriodRecord {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    kind: controlled(PeriodKind, row.kind, 'period kind'),
    periodNumber: row.period_number,
    label: row.label,
    startTime: row.start_time,
    endTime: row.end_time,
    status: controlled(RecordStatus, row.status, 'status'),
  };
}

/** Offset used to move sequences out of the way while renumbering (unique per year). */
const SEQUENCE_PARKING = 100_000;

export class KyselyPeriodRepository implements PeriodRepository {
  constructor(private readonly db: Kysely<Database>) {}

  listByYear(academicYearId: string) {
    return guard(async () =>
      (
        await this.db
          .selectFrom('periods')
          .selectAll()
          .where('academic_year_id', '=', academicYearId)
          .orderBy('start_time')
          .orderBy('end_time')
          .orderBy('label')
          .execute()
      ).map(toPeriod),
    );
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('periods')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toPeriod(row) : null;
    });
  }

  create(record: PeriodRecord, now: string) {
    return guard(async () => {
      const max = await this.db
        .selectFrom('periods')
        .select((eb) => eb.fn.max('sequence').as('max'))
        .where('academic_year_id', '=', record.academicYearId)
        .executeTakeFirst();
      await this.db
        .insertInto('periods')
        .values({
          id: record.id,
          academic_year_id: record.academicYearId,
          sequence: Number(max?.max ?? 0) + 1,
          period_number: record.periodNumber,
          kind: record.kind,
          label: record.label,
          start_time: record.startTime,
          end_time: record.endTime,
          status: record.status,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  update(id: string, changes: Parameters<PeriodRepository['update']>[1], now: string) {
    return guard(async () => {
      await this.db
        .updateTable('periods')
        .set({
          ...(changes.periodNumber !== undefined ? { period_number: changes.periodNumber } : {}),
          ...(changes.label !== undefined ? { label: changes.label } : {}),
          ...(changes.startTime !== undefined ? { start_time: changes.startTime } : {}),
          ...(changes.endTime !== undefined ? { end_time: changes.endTime } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  delete(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('periods').where('id', '=', id).execute();
    });
  }

  resequence(academicYearId: string, now: string) {
    return guard(async () => {
      const rows = await this.listByYear(academicYearId);
      // Two passes so the (year, sequence) unique constraint never sees a duplicate.
      await this.db
        .updateTable('periods')
        .set((eb) => ({ sequence: eb('sequence', '+', SEQUENCE_PARKING) }))
        .where('academic_year_id', '=', academicYearId)
        .execute();
      for (const [index, row] of rows.entries()) {
        await this.db
          .updateTable('periods')
          .set({ sequence: index + 1, updated_at: now })
          .where('id', '=', row.id)
          .execute();
      }
    });
  }
}
