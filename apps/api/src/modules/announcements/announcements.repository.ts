import type { AnnouncementAudience, AnnouncementStatus } from '@ttlmhss/shared';

/**
 * Repository interface for announcements (Phase 10). The Kysely adapter lives in
 * src/data/kysely/repositories/communication.
 */
export interface AnnouncementRecord {
  id: string;
  academicYearId: string;
  yearLabel: string;
  yearStatus: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  classId: string | null;
  className: string | null;
  sectionId: string | null;
  sectionName: string | null;
  status: AnnouncementStatus;
  publishedAt: string | null;
  expiresOn: string | null;
  createdBy: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementValues {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  classId: string | null;
  sectionId: string | null;
  expiresOn: string | null;
}

/** Management list. */
export interface AnnouncementFilter {
  academicYearId: string | null;
  status: AnnouncementStatus | null;
  audience: AnnouncementAudience | null;
  q: string | null;
  /** Class-teacher scope: only SECTION announcements of these sections. null = everything. */
  sectionIds: string[] | null;
  offset: number;
  limit: number;
}

/** What one viewer may read: published, already published, not expired, for their audience. */
export interface AnnouncementFeedFilter {
  academicYearId: string;
  /** Timestamp: published_at must be on or before it. */
  now: string;
  /** Date: expires_on must be null or on/after it. */
  today: string;
  /** Administrators read every audience. */
  everything: boolean;
  staff: boolean;
  classIds: string[];
  sectionIds: string[];
  offset: number;
  limit: number;
}

export interface AnnouncementRepository {
  find(id: string): Promise<AnnouncementRecord | null>;
  list(filter: AnnouncementFilter): Promise<{ rows: AnnouncementRecord[]; total: number }>;
  feed(filter: AnnouncementFeedFilter): Promise<{ rows: AnnouncementRecord[]; total: number }>;
  create(
    a: AnnouncementValues & {
      id: string;
      academicYearId: string;
      status: AnnouncementStatus;
      publishedAt: string | null;
      createdBy: string;
    },
    now: string,
  ): Promise<void>;
  update(id: string, values: AnnouncementValues, actorUserId: string, now: string): Promise<void>;
  setStatus(
    id: string,
    status: AnnouncementStatus,
    published: { at: string; by: string } | null,
    actorUserId: string,
    now: string,
  ): Promise<void>;
}
