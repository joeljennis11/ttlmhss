import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { inList, withId, withReference, withTimestamps } from './ddl-helpers.js';

/**
 * 0009 — Academic (working-day) calendar (Phase 8A).
 *
 * The weekly pattern stays where it is (academic_years.working_days, Phase 4) and remains the
 * default. This adds date-specific EXCEPTIONS:
 *
 * calendar_entries — one date of one academic year declared a WORKING day or a HOLIDAY, for the
 *   whole school (scope SCHOOL), some classes (CLASSES) or some sections (SECTIONS), with a reason.
 *   At most one whole-school entry per date (partial unique index). Overlaps between class/section
 *   entries are refused by the service (structural check, see BR-CAL-04).
 *
 * calendar_entry_targets — the classes or sections an entry applies to (exactly one of class_id /
 *   section_id per row). Classes and sections are the Phase 4 master data; nothing is copied.
 *
 * All references are ON DELETE RESTRICT (a class/section used by the calendar cannot be deleted).
 * No rows are inserted.
 */
const STATUSES = ['WORKING', 'HOLIDAY'] as const;
const SCOPES = ['SCHOOL', 'CLASSES', 'SECTIONS'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Kysely<any>;

async function up(db: Db): Promise<void> {
  let entries = withId(db.schema.createTable('calendar_entries'));
  entries = withReference(entries, 'calendar_entries', 'academic_year_id', 'academic_years');
  entries = entries
    .addColumn('date', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_calendar_entries_status', inList('status', STATUSES))
    .addColumn('scope', 'text', (col) => col.notNull())
    .addCheckConstraint('ck_calendar_entries_scope', inList('scope', SCOPES))
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('note', 'text');
  entries = withReference(entries, 'calendar_entries', 'created_by', 'users', { nullable: true });
  entries = withReference(entries, 'calendar_entries', 'updated_by', 'users', { nullable: true });
  await withTimestamps(entries).execute();

  await db.schema
    .createIndex('ix_calendar_entries_year_date')
    .on('calendar_entries')
    .columns(['academic_year_id', 'date'])
    .execute();
  // One whole-school entry per date (it would overlap any other entry anyway).
  await db.schema
    .createIndex('ux_calendar_entries_school_date')
    .on('calendar_entries')
    .columns(['academic_year_id', 'date'])
    .unique()
    .where(sql.ref('scope'), '=', sql.lit('SCHOOL'))
    .execute();

  let targets = db.schema.createTable('calendar_entry_targets');
  targets = withReference(targets, 'calendar_entry_targets', 'entry_id', 'calendar_entries');
  targets = withReference(targets, 'calendar_entry_targets', 'class_id', 'classes', {
    nullable: true,
  });
  targets = withReference(targets, 'calendar_entry_targets', 'section_id', 'sections', {
    nullable: true,
  });
  await targets
    .addCheckConstraint(
      'ck_calendar_entry_targets_one',
      sql`(class_id is not null and section_id is null) or (class_id is null and section_id is not null)`,
    )
    .execute();
  await db.schema
    .createIndex('ux_calendar_entry_targets_class')
    .on('calendar_entry_targets')
    .columns(['entry_id', 'class_id'])
    .unique()
    .where(sql.ref('class_id'), 'is not', null)
    .execute();
  await db.schema
    .createIndex('ux_calendar_entry_targets_section')
    .on('calendar_entry_targets')
    .columns(['entry_id', 'section_id'])
    .unique()
    .where(sql.ref('section_id'), 'is not', null)
    .execute();
}

async function down(db: Db): Promise<void> {
  await db.schema.dropTable('calendar_entry_targets').execute();
  await db.schema.dropTable('calendar_entries').execute();
}

export const migration0009AcademicCalendar: Migration = { up, down };
