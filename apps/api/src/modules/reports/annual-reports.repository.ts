import type { AnnualReportStatus } from '@ttlmhss/shared';

/**
 * Repository interface for annual reports (Phase 11). The Kysely adapter lives in
 * src/data/kysely/repositories/reports.
 */
export interface AnnualReportRecord {
  id: string;
  academicYearId: string;
  studentId: string;
  enrolmentId: string;
  sectionId: string;
  status: AnnualReportStatus;
  finalRemark: string | null;
  /** Frozen display-ready content (JSON) once FINALIZED; null while DRAFT. */
  snapshotJson: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Fields an action changes. Omitted = unchanged. */
export interface AnnualReportChange {
  status?: AnnualReportStatus;
  finalRemark?: string | null;
  snapshotJson?: string | null;
  finalizedAt?: string | null;
  finalizedBy?: string | null;
  publishedAt?: string | null;
  publishedBy?: string | null;
}

export interface AnnualReportRepository {
  find(id: string): Promise<AnnualReportRecord | null>;
  findFor(academicYearId: string, studentId: string): Promise<AnnualReportRecord | null>;
  listForSection(academicYearId: string, sectionId: string): Promise<AnnualReportRecord[]>;
  listPublishedForStudent(studentId: string): Promise<AnnualReportRecord[]>;
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
  ): Promise<void>;
  /** Applies the change only while the row has `expectedRevision` (then revision + 1). */
  update(
    id: string,
    expectedRevision: number,
    change: AnnualReportChange,
    actorUserId: string,
    now: string,
  ): Promise<boolean>;
}
