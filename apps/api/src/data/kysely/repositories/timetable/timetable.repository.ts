import { RecordStatus, TimetableStatus, Weekday } from '@ttlmhss/shared';
import { sql, type Kysely } from 'kysely';
import { newId } from '../../../../core/utils/clock.js';
import type {
  EntryFilter,
  NewTimetableEntry,
  TimetableEntryRecord,
  TimetableRepository,
  TimetableVersionRecord,
} from '../../../../modules/timetable/timetable.repository.js';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { controlled } from '../config/structure.repositories.js';

export class KyselyTimetableRepository implements TimetableRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ---- versions --------------------------------------------------------------------------------

  private versions() {
    return this.db
      .selectFrom('timetable_versions as v')
      .leftJoin('users as cu', 'cu.id', 'v.created_by')
      .leftJoin('users as uu', 'uu.id', 'v.updated_by')
      .leftJoin('users as pu', 'pu.id', 'v.published_by')
      .select((eb) => [
        'v.id',
        'v.academic_year_id',
        'v.version_number',
        'v.status',
        'v.created_at',
        'v.created_by',
        'cu.username as created_by_name',
        'v.updated_at',
        'v.updated_by',
        'uu.username as updated_by_name',
        'v.published_at',
        'v.published_by',
        'pu.username as published_by_name',
        'v.superseded_at',
        eb
          .selectFrom('timetable_entries as e')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('e.version_id', '=', 'v.id')
          .as('entry_count'),
      ]);
  }

  private toVersion(row: {
    id: string;
    academic_year_id: string;
    version_number: number;
    status: string;
    created_at: string;
    created_by: string | null;
    created_by_name: string | null;
    updated_at: string;
    updated_by: string | null;
    updated_by_name: string | null;
    published_at: string | null;
    published_by: string | null;
    published_by_name: string | null;
    superseded_at: string | null;
    entry_count: number | string | bigint | null;
  }): TimetableVersionRecord {
    return {
      id: row.id,
      academicYearId: row.academic_year_id,
      versionNumber: Number(row.version_number),
      status: controlled(TimetableStatus, row.status, 'timetable status'),
      entryCount: Number(row.entry_count ?? 0),
      createdAt: row.created_at,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      updatedByName: row.updated_by_name,
      publishedAt: row.published_at,
      publishedBy: row.published_by,
      publishedByName: row.published_by_name,
      supersededAt: row.superseded_at,
    };
  }

  findVersion(id: string) {
    return guard(async () => {
      const row = await this.versions().where('v.id', '=', id).executeTakeFirst();
      return row ? this.toVersion(row) : null;
    });
  }

  versionWithStatus(academicYearId: string, status: 'DRAFT' | 'PUBLISHED') {
    return guard(async () => {
      const row = await this.versions()
        .where('v.academic_year_id', '=', academicYearId)
        .where('v.status', '=', status)
        .executeTakeFirst();
      return row ? this.toVersion(row) : null;
    });
  }

  listVersions(academicYearId: string) {
    return guard(async () => {
      const rows = await this.versions()
        .where('v.academic_year_id', '=', academicYearId)
        .orderBy('v.version_number', 'desc')
        .execute();
      return rows.map((r) => this.toVersion(r));
    });
  }

  nextVersionNumber(academicYearId: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('timetable_versions')
        .select((eb) => eb.fn.max('version_number').as('n'))
        .where('academic_year_id', '=', academicYearId)
        .executeTakeFirst();
      return Number(row?.n ?? 0) + 1;
    });
  }

  createDraft(
    v: { id: string; academicYearId: string; versionNumber: number },
    actorUserId: string,
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('timetable_versions')
        .values({
          id: v.id,
          academic_year_id: v.academicYearId,
          version_number: v.versionNumber,
          status: 'DRAFT',
          created_by: actorUserId,
          updated_by: actorUserId,
          published_by: null,
          published_at: null,
          superseded_at: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  touch(versionId: string, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('timetable_versions')
        .set({ updated_by: actorUserId, updated_at: now })
        .where('id', '=', versionId)
        .execute();
    });
  }

  markPublished(versionId: string, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('timetable_versions')
        .set({
          status: 'PUBLISHED',
          published_by: actorUserId,
          published_at: now,
          updated_by: actorUserId,
          updated_at: now,
        })
        .where('id', '=', versionId)
        .where('status', '=', 'DRAFT')
        .execute();
    });
  }

  markSuperseded(versionId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('timetable_versions')
        .set({ status: 'SUPERSEDED', superseded_at: now, updated_at: now })
        .where('id', '=', versionId)
        .where('status', '=', 'PUBLISHED')
        .execute();
    });
  }

  deleteDraft(versionId: string) {
    return guard(async () => {
      await this.db
        .deleteFrom('timetable_versions')
        .where('id', '=', versionId)
        .where('status', '=', 'DRAFT')
        .execute();
    });
  }

  // ---- entries ---------------------------------------------------------------------------------

  private entries() {
    return this.db
      .selectFrom('timetable_entries as e')
      .innerJoin('sections as s', 's.id', 'e.section_id')
      .innerJoin('classes as c', 'c.id', 's.class_id')
      .innerJoin('subjects as sub', 'sub.id', 'e.subject_id')
      .innerJoin('teachers as t', 't.id', 'e.teacher_id')
      .select([
        'e.id',
        'e.version_id',
        'e.academic_year_id',
        'e.day',
        'e.period_id',
        'e.section_id',
        's.name as section_name',
        's.status as section_status',
        'c.id as class_id',
        'c.name as class_name',
        'c.status as class_status',
        'c.display_order as class_order',
        'e.subject_id',
        'sub.name as subject_name',
        'sub.code as subject_code',
        'sub.status as subject_status',
        'e.teacher_id',
        't.full_name as teacher_name',
        't.staff_code',
        't.status as teacher_status',
        'e.created_at',
        'e.updated_at',
      ]);
  }

  private toEntry(row: {
    id: string;
    version_id: string;
    academic_year_id: string;
    day: string;
    period_id: string;
    section_id: string;
    section_name: string;
    section_status: string;
    class_id: string;
    class_name: string;
    class_status: string;
    subject_id: string;
    subject_name: string;
    subject_code: string | null;
    subject_status: string;
    teacher_id: string;
    teacher_name: string;
    staff_code: string;
    teacher_status: string;
    created_at: string;
    updated_at: string;
  }): TimetableEntryRecord {
    return {
      id: row.id,
      versionId: row.version_id,
      academicYearId: row.academic_year_id,
      day: controlled(Weekday, row.day, 'timetable day'),
      periodId: row.period_id,
      sectionId: row.section_id,
      sectionName: row.section_name,
      sectionStatus: controlled(RecordStatus, row.section_status, 'section status'),
      classId: row.class_id,
      className: row.class_name,
      classStatus: controlled(RecordStatus, row.class_status, 'class status'),
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      subjectCode: row.subject_code,
      subjectStatus: controlled(RecordStatus, row.subject_status, 'subject status'),
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      staffCode: row.staff_code,
      teacherStatus: controlled(RecordStatus, row.teacher_status, 'teacher status'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  copyEntries(fromVersionId: string, toVersionId: string, actorUserId: string, now: string) {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('timetable_entries')
        .selectAll()
        .where('version_id', '=', fromVersionId)
        .execute();
      for (const row of rows) {
        await this.db
          .insertInto('timetable_entries')
          .values({
            ...row,
            id: newId(),
            version_id: toVersionId,
            created_by: actorUserId,
            updated_by: actorUserId,
            created_at: now,
            updated_at: now,
          })
          .execute();
      }
      return rows.length;
    });
  }

  listEntries(versionId: string, filter: EntryFilter = {}) {
    return guard(async () => {
      let query = this.entries().where('e.version_id', '=', versionId);
      if (filter.sectionId) query = query.where('e.section_id', '=', filter.sectionId);
      if (filter.teacherId) query = query.where('e.teacher_id', '=', filter.teacherId);
      if (filter.day) query = query.where('e.day', '=', filter.day);
      const rows = await query
        .orderBy('class_order')
        .orderBy('c.name')
        .orderBy('s.name')
        .orderBy('e.day')
        .orderBy('e.id')
        .execute();
      return rows.map((r) => this.toEntry(r));
    });
  }

  findEntry(id: string) {
    return guard(async () => {
      const row = await this.entries().where('e.id', '=', id).executeTakeFirst();
      return row ? this.toEntry(row) : null;
    });
  }

  sectionSlot(versionId: string, sectionId: string, day: Weekday, periodId: string) {
    return guard(async () => {
      const row = await this.entries()
        .where('e.version_id', '=', versionId)
        .where('e.section_id', '=', sectionId)
        .where('e.day', '=', day)
        .where('e.period_id', '=', periodId)
        .executeTakeFirst();
      return row ? this.toEntry(row) : null;
    });
  }

  teacherSlot(versionId: string, teacherId: string, day: Weekday, periodId: string) {
    return guard(async () => {
      const row = await this.entries()
        .where('e.version_id', '=', versionId)
        .where('e.teacher_id', '=', teacherId)
        .where('e.day', '=', day)
        .where('e.period_id', '=', periodId)
        .executeTakeFirst();
      return row ? this.toEntry(row) : null;
    });
  }

  insertEntry(entry: NewTimetableEntry, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('timetable_entries')
        .values({
          id: entry.id,
          version_id: entry.versionId,
          academic_year_id: entry.academicYearId,
          day: entry.day,
          period_id: entry.periodId,
          section_id: entry.sectionId,
          subject_id: entry.subjectId,
          teacher_id: entry.teacherId,
          created_by: actorUserId,
          updated_by: actorUserId,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateEntry(
    id: string,
    changes: Partial<Pick<NewTimetableEntry, 'day' | 'periodId' | 'subjectId' | 'teacherId'>>,
    actorUserId: string,
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .updateTable('timetable_entries')
        .set({
          ...(changes.day !== undefined ? { day: changes.day } : {}),
          ...(changes.periodId !== undefined ? { period_id: changes.periodId } : {}),
          ...(changes.subjectId !== undefined ? { subject_id: changes.subjectId } : {}),
          ...(changes.teacherId !== undefined ? { teacher_id: changes.teacherId } : {}),
          updated_by: actorUserId,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  deleteEntry(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('timetable_entries').where('id', '=', id).execute();
    });
  }

  deleteEntries(versionId: string) {
    return guard(async () => {
      await this.db.deleteFrom('timetable_entries').where('version_id', '=', versionId).execute();
    });
  }

  // ---- usage guards ----------------------------------------------------------------------------

  private async count(query: Promise<{ n: number | string | bigint } | undefined>) {
    return Number((await query)?.n ?? 0);
  }

  countForPeriod(periodId: string) {
    return guard(() =>
      this.count(
        this.db
          .selectFrom('timetable_entries')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('period_id', '=', periodId)
          .executeTakeFirst(),
      ),
    );
  }

  countLiveForTeacherSubject(teacherId: string, subjectId: string) {
    return guard(() =>
      this.count(
        this.db
          .selectFrom('timetable_entries as e')
          .innerJoin('timetable_versions as v', 'v.id', 'e.version_id')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('e.teacher_id', '=', teacherId)
          .where('e.subject_id', '=', subjectId)
          .where('v.status', 'in', ['DRAFT', 'PUBLISHED'])
          .executeTakeFirst(),
      ),
    );
  }

  countForTeacher(teacherId: string) {
    return guard(() =>
      this.count(
        this.db
          .selectFrom('timetable_entries')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('teacher_id', '=', teacherId)
          .executeTakeFirst(),
      ),
    );
  }

  yearIdsInUse() {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('timetable_versions')
        .select(sql<string>`distinct academic_year_id`.as('id'))
        .execute();
      return new Set(rows.map((r) => r.id));
    });
  }
}
