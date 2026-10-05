/**
 * Repository interfaces for achievements (Phase 9). The Kysely adapter lives in
 * src/data/kysely/repositories/achievements.
 */
export type AchievementStatus = 'ACTIVE' | 'ARCHIVED';

export interface AchievementRecord {
  id: string;
  academicYearId: string;
  yearLabel: string;
  yearStatus: string;
  studentId: string;
  fullName: string;
  admissionNumber: string;
  enrolmentId: string;
  rollNumber: string | null;
  sectionId: string;
  sectionName: string;
  classId: string;
  className: string;
  categoryId: string;
  categoryName: string;
  title: string;
  description: string | null;
  achievedOn: string;
  attachmentRef: string | null;
  status: AchievementStatus;
  createdByName: string | null;
  updatedAt: string;
}

export interface AchievementFilter {
  academicYearId: string | null;
  /** Restrict to placements in these sections (scope or filter); null = no restriction. */
  sectionIds: string[] | null;
  studentId: string | null;
  categoryId: string | null;
  from: string | null;
  to: string | null;
  q: string | null;
  status: AchievementStatus | 'ALL';
  offset: number;
  limit: number;
}

export interface AchievementValues {
  categoryId: string;
  title: string;
  description: string | null;
  achievedOn: string;
  enrolmentId: string;
}

export interface AchievementRepository {
  find(id: string): Promise<AchievementRecord | null>;
  list(filter: AchievementFilter): Promise<{ rows: AchievementRecord[]; total: number }>;
  create(
    a: AchievementValues & {
      id: string;
      academicYearId: string;
      studentId: string;
      createdBy: string;
    },
    now: string,
  ): Promise<void>;
  update(id: string, values: AchievementValues, actorUserId: string, now: string): Promise<void>;
  setStatus(id: string, status: AchievementStatus, actorUserId: string, now: string): Promise<void>;
  delete(id: string): Promise<void>;
}
