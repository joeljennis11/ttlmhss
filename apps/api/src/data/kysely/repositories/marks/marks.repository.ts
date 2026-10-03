import { MarkSheetStatus, type MarkStructure } from '@ttlmhss/shared';
import { sql, type Kysely, type Selectable } from 'kysely';
import type {
  MarkEntryDerived,
  MarkEntryRecord,
  MarkEntryValues,
  MarkSheetChanges,
  MarkSheetRecord,
  MarksRepository,
  NewMarkSheet,
} from '../../../../modules/marks/marks.repository.js';
import type { Database, MarkEntriesTable, MarkSheetsTable } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { controlled } from '../config/structure.repositories.js';

const num = (v: number | string | bigint | null | undefined) =>
  v === null || v === undefined ? null : Number(v);

/** A user's readable name for history: the teacher's name, else the username. */
const nameOf = (column: string) =>
  sql<
    string | null
  >`(select coalesce(t.full_name, u.username) from users u left join teachers t on t.user_id = u.id where u.id = ${sql.ref(column)})`;

type SheetRow = Selectable<MarkSheetsTable> & {
  submitted_by_name: string | null;
  unlocked_by_name: string | null;
  updated_by_name: string | null;
};
type EntryRow = Selectable<MarkEntriesTable> & { updated_by_name: string | null };

function toSheet(r: SheetRow): MarkSheetRecord {
  return {
    id: r.id,
    academicYearId: r.academic_year_id,
    examId: r.exam_id,
    examSubjectId: r.exam_subject_id,
    classId: r.class_id,
    sectionId: r.section_id,
    subjectId: r.subject_id,
    entryTeacherId: r.entry_teacher_id,
    status: controlled(MarkSheetStatus, r.status, 'mark sheet status'),
    revision: Number(r.revision),
    calculation: r.calculation ? (JSON.parse(r.calculation) as MarkStructure) : null,
    submittedAt: r.submitted_at,
    submittedByName: r.submitted_by_name,
    unlockedAt: r.unlocked_at,
    unlockedByName: r.unlocked_by_name,
    unlockReason: r.unlock_reason,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name,
  };
}

function toEntry(r: EntryRow): MarkEntryRecord {
  return {
    id: r.id,
    markSheetId: r.mark_sheet_id,
    academicYearId: r.academic_year_id,
    sectionId: r.section_id,
    enrolmentId: r.enrolment_id,
    studentId: r.student_id,
    theoryCm: num(r.theory_cm),
    internalCm: num(r.internal_cm),
    practicalCm: num(r.practical_cm),
    totalCm: num(r.total_cm),
    normalizedCm: num(r.normalized_cm),
    percentBp: num(r.percent_bp),
    grade: r.grade,
    passed: r.passed === null ? null : Number(r.passed) === 1,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name,
  };
}

export class KyselyMarksRepository implements MarksRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private sheets() {
    return this.db
      .selectFrom('mark_sheets')
      .selectAll('mark_sheets')
      .select([
        nameOf('mark_sheets.submitted_by').as('submitted_by_name'),
        nameOf('mark_sheets.unlocked_by').as('unlocked_by_name'),
        nameOf('mark_sheets.updated_by').as('updated_by_name'),
      ]);
  }

  findSheet(examSubjectId: string, sectionId: string) {
    return guard(async () => {
      const row = await this.sheets()
        .where('exam_subject_id', '=', examSubjectId)
        .where('section_id', '=', sectionId)
        .executeTakeFirst();
      return row ? toSheet(row) : null;
    });
  }

  sheetsForExam(examId: string) {
    return guard(async () =>
      (await this.sheets().where('exam_id', '=', examId).execute()).map(toSheet),
    );
  }

  sheetsForExamSubjects(examSubjectIds: string[]) {
    return guard(async () =>
      examSubjectIds.length === 0
        ? []
        : (await this.sheets().where('exam_subject_id', 'in', examSubjectIds).execute()).map(
            toSheet,
          ),
    );
  }

  sheetsForTeacher(teacherId: string) {
    return guard(async () =>
      (await this.sheets().where('entry_teacher_id', '=', teacherId).execute()).map(toSheet),
    );
  }

  createSheet(sheet: NewMarkSheet, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('mark_sheets')
        .values({
          id: sheet.id,
          academic_year_id: sheet.academicYearId,
          exam_id: sheet.examId,
          exam_subject_id: sheet.examSubjectId,
          class_id: sheet.classId,
          section_id: sheet.sectionId,
          subject_id: sheet.subjectId,
          entry_teacher_id: sheet.entryTeacherId,
          status: 'DRAFT',
          revision: 1,
          calculation: null,
          submitted_at: null,
          submitted_by: null,
          unlocked_at: null,
          unlocked_by: null,
          unlock_reason: null,
          created_by: sheet.createdBy,
          updated_by: sheet.createdBy,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateSheet(id: string, c: MarkSheetChanges, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('mark_sheets')
        .set((eb) => ({
          ...(c.entryTeacherId !== undefined ? { entry_teacher_id: c.entryTeacherId } : {}),
          ...(c.status !== undefined ? { status: c.status } : {}),
          ...(c.calculation !== undefined
            ? { calculation: c.calculation === null ? null : JSON.stringify(c.calculation) }
            : {}),
          ...(c.submittedAt !== undefined ? { submitted_at: c.submittedAt } : {}),
          ...(c.submittedBy !== undefined ? { submitted_by: c.submittedBy } : {}),
          ...(c.unlockedAt !== undefined ? { unlocked_at: c.unlockedAt } : {}),
          ...(c.unlockedBy !== undefined ? { unlocked_by: c.unlockedBy } : {}),
          ...(c.unlockReason !== undefined ? { unlock_reason: c.unlockReason } : {}),
          revision: eb('revision', '+', 1),
          updated_by: actorUserId,
          updated_at: now,
        }))
        .where('id', '=', id)
        .execute();
    });
  }

  claimRevision(id: string, expected: number, actorUserId: string, now: string) {
    return guard(async () => {
      const result = await this.db
        .updateTable('mark_sheets')
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

  private entries() {
    return this.db
      .selectFrom('mark_entries')
      .selectAll('mark_entries')
      .select(nameOf('mark_entries.updated_by').as('updated_by_name'));
  }

  entriesForSheets(sheetIds: string[]) {
    return guard(async () =>
      sheetIds.length === 0
        ? []
        : (await this.entries().where('mark_sheet_id', 'in', sheetIds).execute()).map(toEntry),
    );
  }

  entriesForStudent(studentId: string) {
    return guard(async () =>
      (await this.entries().where('student_id', '=', studentId).execute()).map(toEntry),
    );
  }

  insertEntry(
    e: Omit<MarkEntryRecord, 'updatedAt' | 'updatedByName' | keyof MarkEntryDerived> & {
      createdBy: string;
    },
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('mark_entries')
        .values({
          id: e.id,
          mark_sheet_id: e.markSheetId,
          academic_year_id: e.academicYearId,
          section_id: e.sectionId,
          enrolment_id: e.enrolmentId,
          student_id: e.studentId,
          theory_cm: e.theoryCm,
          internal_cm: e.internalCm,
          practical_cm: e.practicalCm,
          total_cm: null,
          normalized_cm: null,
          percent_bp: null,
          grade: null,
          passed: null,
          created_by: e.createdBy,
          updated_by: e.createdBy,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateEntryValues(id: string, v: MarkEntryValues, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('mark_entries')
        .set({
          theory_cm: v.theoryCm,
          internal_cm: v.internalCm,
          practical_cm: v.practicalCm,
          total_cm: null,
          normalized_cm: null,
          percent_bp: null,
          grade: null,
          passed: null,
          updated_by: actorUserId,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  setEntryDerived(id: string, d: MarkEntryDerived) {
    return guard(async () => {
      await this.db
        .updateTable('mark_entries')
        .set({
          total_cm: d.totalCm,
          normalized_cm: d.normalizedCm,
          percent_bp: d.percentBp,
          grade: d.grade,
          passed: d.passed === null ? null : d.passed ? 1 : 0,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  deleteEmptySheet(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('mark_entries').where('mark_sheet_id', '=', id).execute();
      await this.db.deleteFrom('mark_sheets').where('id', '=', id).execute();
    });
  }
}
