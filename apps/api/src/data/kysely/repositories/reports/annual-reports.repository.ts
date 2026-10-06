import type { Kysely } from 'kysely';
import type { AnnualReportStatus } from '@ttlmhss/shared';
import type {
  AnnualReportChange,
  AnnualReportRecord,
  AnnualReportRepository,
} from '../../../../modules/reports/annual-reports.repository.js';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { userName } from '../communication/announcements.repository.js';

export class KyselyAnnualReportRepository implements AnnualReportRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private columns() {
    return this.db
      .selectFrom('annual_reports as r')
      .select([
        'r.id',
        'r.academic_year_id',
        'r.student_id',
        'r.enrolment_id',
        'r.section_id',
        'r.status',
        'r.final_remark',
        'r.snapshot_json',
        'r.finalized_at',
        userName('r.finalized_by').as('finalized_by_name'),
        'r.published_at',
        userName('r.published_by').as('published_by_name'),
        'r.revision',
        'r.created_at',
        'r.updated_at',
      ]);
  }

  private toRecord(r: Record<string, unknown>): AnnualReportRecord {
    const s = (k: string) => (r[k] as string | null) ?? null;
    return {
      id: r.id as string,
      academicYearId: r.academic_year_id as string,
      studentId: r.student_id as string,
      enrolmentId: r.enrolment_id as string,
      sectionId: r.section_id as string,
      status: r.status as AnnualReportStatus,
      finalRemark: s('final_remark'),
      snapshotJson: s('snapshot_json'),
      finalizedAt: s('finalized_at'),
      finalizedByName: s('finalized_by_name'),
      publishedAt: s('published_at'),
      publishedByName: s('published_by_name'),
      revision: Number(r.revision),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.columns().where('r.id', '=', id).executeTakeFirst();
      return row ? this.toRecord(row) : null;
    });
  }

  findFor(academicYearId: string, studentId: string) {
    return guard(async () => {
      const row = await this.columns()
        .where('r.academic_year_id', '=', academicYearId)
        .where('r.student_id', '=', studentId)
        .executeTakeFirst();
      return row ? this.toRecord(row) : null;
    });
  }

  listForSection(academicYearId: string, sectionId: string) {
    return guard(async () => {
      const rows = await this.columns()
        .where('r.academic_year_id', '=', academicYearId)
        .where('r.section_id', '=', sectionId)
        .execute();
      return rows.map((r) => this.toRecord(r));
    });
  }

  listPublishedForStudent(studentId: string) {
    return guard(async () => {
      const rows = await this.columns()
        .where('r.student_id', '=', studentId)
        .where('r.status', '=', 'PUBLISHED')
        .orderBy('r.published_at', 'desc')
        .execute();
      return rows.map((r) => this.toRecord(r));
    });
  }

  create(
    r: {
      id: string;
      academicYearId: string;
      studentId: string;
      enrolmentId: string;
      sectionId: string;
      createdBy: string;
    },
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('annual_reports')
        .values({
          id: r.id,
          academic_year_id: r.academicYearId,
          student_id: r.studentId,
          enrolment_id: r.enrolmentId,
          section_id: r.sectionId,
          status: 'DRAFT',
          final_remark: null,
          snapshot_json: null,
          finalized_at: null,
          finalized_by: null,
          published_at: null,
          published_by: null,
          revision: 1,
          created_by: r.createdBy,
          updated_by: r.createdBy,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  update(
    id: string,
    expectedRevision: number,
    c: AnnualReportChange,
    actorUserId: string,
    now: string,
  ) {
    return guard(async () => {
      const result = await this.db
        .updateTable('annual_reports')
        .set((eb) => ({
          ...(c.status !== undefined ? { status: c.status } : {}),
          ...(c.finalRemark !== undefined ? { final_remark: c.finalRemark } : {}),
          ...(c.snapshotJson !== undefined ? { snapshot_json: c.snapshotJson } : {}),
          ...(c.finalizedAt !== undefined ? { finalized_at: c.finalizedAt } : {}),
          ...(c.finalizedBy !== undefined ? { finalized_by: c.finalizedBy } : {}),
          ...(c.publishedAt !== undefined ? { published_at: c.publishedAt } : {}),
          ...(c.publishedBy !== undefined ? { published_by: c.publishedBy } : {}),
          revision: eb('revision', '+', 1),
          updated_by: actorUserId,
          updated_at: now,
        }))
        .where('id', '=', id)
        .where('revision', '=', expectedRevision)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    });
  }
}
