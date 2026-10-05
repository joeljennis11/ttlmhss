import { sql, type Kysely } from 'kysely';
import type {
  AnnouncementFeedFilter,
  AnnouncementFilter,
  AnnouncementRecord,
  AnnouncementRepository,
  AnnouncementValues,
} from '../../../../modules/announcements/announcements.repository.js';
import type { AnnouncementAudience, AnnouncementStatus } from '@ttlmhss/shared';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { likePattern } from '../people/student.repositories.js';

/** Display name of a user: teacher or student name, else the username. */
export const userName = (column: string) =>
  sql<string | null>`(select coalesce(t.full_name, st.full_name, u.username) from users u
    left join teachers t on t.user_id = u.id left join students st on st.user_id = u.id
    where u.id = ${sql.ref(column)})`;

export class KyselyAnnouncementRepository implements AnnouncementRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private columns() {
    return this.db
      .selectFrom('announcements as a')
      .innerJoin('academic_years as y', 'y.id', 'a.academic_year_id')
      .leftJoin('classes as c', 'c.id', 'a.class_id')
      .leftJoin('sections as s', 's.id', 'a.section_id')
      .select([
        'a.id',
        'a.academic_year_id',
        'y.label as year_label',
        'y.status as year_status',
        'a.title',
        'a.body',
        'a.audience',
        'a.class_id',
        'c.name as class_name',
        'a.section_id',
        's.name as section_name',
        'a.status',
        'a.published_at',
        'a.expires_on',
        'a.created_by',
        'a.created_at',
        'a.updated_at',
        userName('a.created_by').as('author_name'),
      ]);
  }

  private toRecord(r: Record<string, unknown>): AnnouncementRecord {
    return {
      id: r.id as string,
      academicYearId: r.academic_year_id as string,
      yearLabel: r.year_label as string,
      yearStatus: r.year_status as string,
      title: r.title as string,
      body: r.body as string,
      audience: r.audience as AnnouncementAudience,
      classId: (r.class_id as string | null) ?? null,
      className: (r.class_name as string | null) ?? null,
      sectionId: (r.section_id as string | null) ?? null,
      sectionName: (r.section_name as string | null) ?? null,
      status: r.status as AnnouncementStatus,
      publishedAt: (r.published_at as string | null) ?? null,
      expiresOn: (r.expires_on as string | null) ?? null,
      createdBy: r.created_by as string,
      authorName: (r.author_name as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  find(id: string) {
    return guard(async () => {
      const row = await this.columns().where('a.id', '=', id).executeTakeFirst();
      return row ? this.toRecord(row) : null;
    });
  }

  list(f: AnnouncementFilter) {
    return guard(async () => {
      let q = this.columns();
      if (f.academicYearId) q = q.where('a.academic_year_id', '=', f.academicYearId);
      if (f.status) q = q.where('a.status', '=', f.status);
      if (f.audience) q = q.where('a.audience', '=', f.audience);
      if (f.sectionIds) {
        q = q
          .where('a.audience', '=', 'SECTION')
          .where('a.section_id', 'in', f.sectionIds.length ? f.sectionIds : ['']);
      }
      if (f.q) {
        const pattern = likePattern(f.q);
        q = q.where(sql`lower(a.title)`, 'like', sql`${pattern} escape '\\'`);
      }
      const total = await q
        .clearSelect()
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst();
      const rows = await q
        .orderBy('a.updated_at', 'desc')
        .orderBy('a.id')
        .offset(f.offset)
        .limit(f.limit)
        .execute();
      return { rows: rows.map((r) => this.toRecord(r)), total: Number(total?.n ?? 0) };
    });
  }

  feed(f: AnnouncementFeedFilter) {
    return guard(async () => {
      let q = this.columns()
        .where('a.academic_year_id', '=', f.academicYearId)
        .where('a.status', '=', 'PUBLISHED')
        .where('a.published_at', '<=', f.now)
        .where((eb) => eb.or([eb('a.expires_on', 'is', null), eb('a.expires_on', '>=', f.today)]));
      if (!f.everything) {
        q = q.where((eb) =>
          eb.or([
            eb('a.audience', '=', 'SCHOOL'),
            ...(f.staff ? [eb('a.audience', '=', 'STAFF')] : []),
            ...(f.classIds.length
              ? [eb.and([eb('a.audience', '=', 'CLASS'), eb('a.class_id', 'in', f.classIds)])]
              : []),
            ...(f.sectionIds.length
              ? [eb.and([eb('a.audience', '=', 'SECTION'), eb('a.section_id', 'in', f.sectionIds)])]
              : []),
          ]),
        );
      }
      const total = await q
        .clearSelect()
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst();
      const rows = await q
        .orderBy('a.published_at', 'desc')
        .orderBy('a.id')
        .offset(f.offset)
        .limit(f.limit)
        .execute();
      return { rows: rows.map((r) => this.toRecord(r)), total: Number(total?.n ?? 0) };
    });
  }

  create(
    a: AnnouncementValues & {
      id: string;
      academicYearId: string;
      status: AnnouncementStatus;
      publishedAt: string | null;
      createdBy: string;
    },
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('announcements')
        .values({
          id: a.id,
          academic_year_id: a.academicYearId,
          title: a.title,
          body: a.body,
          audience: a.audience,
          class_id: a.classId,
          section_id: a.sectionId,
          status: a.status,
          published_at: a.publishedAt,
          published_by: a.publishedAt ? a.createdBy : null,
          expires_on: a.expiresOn,
          created_by: a.createdBy,
          updated_by: a.createdBy,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  update(id: string, v: AnnouncementValues, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('announcements')
        .set({
          title: v.title,
          body: v.body,
          audience: v.audience,
          class_id: v.classId,
          section_id: v.sectionId,
          expires_on: v.expiresOn,
          updated_by: actorUserId,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  setStatus(
    id: string,
    status: AnnouncementStatus,
    published: { at: string; by: string } | null,
    actorUserId: string,
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .updateTable('announcements')
        .set({
          status,
          ...(published ? { published_at: published.at, published_by: published.by } : {}),
          updated_by: actorUserId,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }
}
