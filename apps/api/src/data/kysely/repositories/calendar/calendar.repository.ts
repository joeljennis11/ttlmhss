import { CalendarDayStatus, CalendarScope } from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import type {
  CalendarEntryRecord,
  CalendarEntryWrite,
  CalendarRepository,
} from '../../../../modules/calendar/calendar.repository.js';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { controlled } from '../config/structure.repositories.js';

export class KyselyCalendarRepository implements CalendarRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private base() {
    return this.db
      .selectFrom('calendar_entries as e')
      .leftJoin('users as cu', 'cu.id', 'e.created_by')
      .leftJoin('users as uu', 'uu.id', 'e.updated_by')
      .select([
        'e.id',
        'e.academic_year_id',
        'e.date',
        'e.status',
        'e.scope',
        'e.reason',
        'e.note',
        'e.created_at',
        'e.created_by',
        'cu.username as created_by_name',
        'e.updated_at',
        'e.updated_by',
        'uu.username as updated_by_name',
      ]);
  }

  private async withTargets(
    rows: Awaited<ReturnType<ReturnType<KyselyCalendarRepository['base']>['execute']>>,
  ): Promise<CalendarEntryRecord[]> {
    if (rows.length === 0) return [];
    const targets = await this.db
      .selectFrom('calendar_entry_targets')
      .selectAll()
      .where(
        'entry_id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    return rows.map((r) => ({
      id: r.id,
      academicYearId: r.academic_year_id,
      date: r.date,
      status: controlled(CalendarDayStatus, r.status, 'calendar status'),
      scope: controlled(CalendarScope, r.scope, 'calendar scope'),
      classIds: targets.filter((t) => t.entry_id === r.id && t.class_id).map((t) => t.class_id!),
      sectionIds: targets
        .filter((t) => t.entry_id === r.id && t.section_id)
        .map((t) => t.section_id!),
      reason: r.reason,
      note: r.note,
      createdAt: r.created_at,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
      updatedByName: r.updated_by_name,
    }));
  }

  listByYear(academicYearId: string) {
    return guard(async () =>
      this.withTargets(
        await this.base()
          .where('e.academic_year_id', '=', academicYearId)
          .orderBy('e.date')
          .orderBy('e.created_at')
          .execute(),
      ),
    );
  }

  listOnDate(academicYearId: string, date: string) {
    return guard(async () =>
      this.withTargets(
        await this.base()
          .where('e.academic_year_id', '=', academicYearId)
          .where('e.date', '=', date)
          .execute(),
      ),
    );
  }

  find(id: string) {
    return guard(async () => {
      const [record] = await this.withTargets(await this.base().where('e.id', '=', id).execute());
      return record ?? null;
    });
  }

  private async insertTargets(e: CalendarEntryWrite) {
    const rows = [
      ...e.classIds.map((classId) => ({ entry_id: e.id, class_id: classId, section_id: null })),
      ...e.sectionIds.map((sectionId) => ({
        entry_id: e.id,
        class_id: null,
        section_id: sectionId,
      })),
    ];
    if (rows.length) await this.db.insertInto('calendar_entry_targets').values(rows).execute();
  }

  create(e: CalendarEntryWrite, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('calendar_entries')
        .values({
          id: e.id,
          academic_year_id: e.academicYearId,
          date: e.date,
          status: e.status,
          scope: e.scope,
          reason: e.reason,
          note: e.note,
          created_by: actorUserId,
          updated_by: actorUserId,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await this.insertTargets(e);
    });
  }

  update(e: CalendarEntryWrite, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('calendar_entries')
        .set({
          date: e.date,
          status: e.status,
          scope: e.scope,
          reason: e.reason,
          note: e.note,
          updated_by: actorUserId,
          updated_at: now,
        })
        .where('id', '=', e.id)
        .execute();
      await this.db.deleteFrom('calendar_entry_targets').where('entry_id', '=', e.id).execute();
      await this.insertTargets(e);
    });
  }

  delete(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('calendar_entry_targets').where('entry_id', '=', id).execute();
      await this.db.deleteFrom('calendar_entries').where('id', '=', id).execute();
    });
  }
}
