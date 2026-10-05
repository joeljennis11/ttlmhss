import type { ProfileField, RequestStatus, RequestType, UserRole } from '@ttlmhss/shared';

/**
 * Repository interface for student requests (Phase 10). The Kysely adapter lives in
 * src/data/kysely/repositories/communication.
 */
export interface RequestRecord {
  id: string;
  type: RequestType;
  status: RequestStatus;
  academicYearId: string;
  yearLabel: string;
  yearStatus: string;
  studentId: string;
  fullName: string;
  admissionNumber: string;
  rollNumber: string | null;
  enrolmentId: string;
  sectionId: string;
  sectionName: string;
  classId: string;
  className: string;
  requestedBy: string;
  requesterName: string;
  requesterRole: UserRole;
  summary: string;
  description: string;
  relatedDate: string | null;
  relatedPeriodId: string | null;
  relatedPeriodLabel: string | null;
  relatedSubjectId: string | null;
  relatedSubjectName: string | null;
  relatedExamId: string | null;
  relatedExamName: string | null;
  profileField: ProfileField | null;
  assignedTo: string | null;
  assignedName: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  closedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewRequest {
  id: string;
  type: RequestType;
  academicYearId: string;
  studentId: string;
  enrolmentId: string;
  sectionId: string;
  requestedBy: string;
  requesterRole: UserRole;
  summary: string;
  description: string;
  relatedDate: string | null;
  relatedPeriodId: string | null;
  relatedSubjectId: string | null;
  relatedExamId: string | null;
  profileField: ProfileField | null;
  assignedTo: string | null;
}

export interface RequestFilter {
  academicYearId: string | null;
  studentId: string | null;
  /** Scope: only requests of these sections. null = no restriction. */
  sectionIds: string[] | null;
  /** Scope: request types the caller may handle. null = all. */
  types: RequestType[] | null;
  statuses: RequestStatus[] | null;
  /** Created at or after / at or before (timestamps). */
  from: string | null;
  to: string | null;
  offset: number;
  limit: number;
}

/** Fields a reviewer's action changes. Omitted = unchanged. */
export interface RequestChange {
  status?: RequestStatus;
  assignedTo?: string | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
}

export interface RequestRepository {
  find(id: string): Promise<RequestRecord | null>;
  list(filter: RequestFilter): Promise<{ rows: RequestRecord[]; total: number }>;
  count(filter: Omit<RequestFilter, 'offset' | 'limit'>): Promise<number>;
  create(request: NewRequest, now: string): Promise<void>;
  /** Applies the change only if the row still has `expectedRevision` (then revision + 1). */
  update(
    id: string,
    expectedRevision: number,
    change: RequestChange,
    now: string,
  ): Promise<boolean>;
}
