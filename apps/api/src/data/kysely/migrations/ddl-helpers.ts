import { sql, type CreateTableBuilder, type Expression, type SqlBool } from 'kysely';

/**
 * Portable DDL helpers shared by migrations. Only features supported by both SQLite and PostgreSQL
 * are used: text/integer columns, CHECK, UNIQUE, FOREIGN KEY ... ON DELETE RESTRICT, partial indexes.
 *
 * Migrations are frozen history: controlled-value lists are written out literally in each migration
 * (not imported from @ttlmhss/shared) so changing a constant later can never silently alter an old
 * migration. Tests verify the database accepts every current controlled value.
 */

/** `column IN ('A', 'B')` built from literals (DDL cannot use bound parameters). */
export function inList(column: string, values: readonly string[]): Expression<SqlBool> {
  return sql<SqlBool>`${sql.ref(column)} in (${sql.join(values.map((value) => sql.lit(value)))})`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = CreateTableBuilder<any, any>;

export function withTimestamps(table: AnyTable): AnyTable {
  return table
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull());
}

/** Text primary key holding an application-generated UUID. */
export function withId(table: AnyTable): AnyTable {
  return table.addColumn('id', 'text', (col) => col.primaryKey().notNull());
}

/** `status` column restricted to the given values. */
export function withStatus(
  table: AnyTable,
  tableName: string,
  values: readonly string[],
): AnyTable {
  return table
    .addColumn('status', 'text', (col) => col.notNull())
    .addCheckConstraint(`ck_${tableName}_status`, inList('status', values));
}

/** Foreign key that refuses deletion of the referenced row (history must never vanish). */
export function withReference(
  table: AnyTable,
  tableName: string,
  column: string,
  target: string,
  options: { nullable?: boolean } = {},
): AnyTable {
  return table
    .addColumn(column, 'text', (col) => (options.nullable ? col : col.notNull()))
    .addForeignKeyConstraint(`fk_${tableName}_${column}`, [column], target, ['id'], (fk) =>
      fk.onDelete('restrict').onUpdate('restrict'),
    );
}

export const RECORD_STATUS_V1 = ['ACTIVE', 'INACTIVE'] as const;
