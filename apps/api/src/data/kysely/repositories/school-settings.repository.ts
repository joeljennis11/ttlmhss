import type { Kysely } from 'kysely';
import type {
  SchoolSettings,
  SchoolSettingsChanges,
  SchoolSettingsRepository,
} from '../../../modules/school/school-settings.repository.js';
import type { Database } from '../database-schema.js';
import { guard } from '../db-errors.js';

export class KyselySchoolSettingsRepository implements SchoolSettingsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  get(): Promise<SchoolSettings | null> {
    return guard(async () => {
      const row = await this.db
        .selectFrom('school_settings')
        .selectAll()
        .where('id', '=', 'default')
        .executeTakeFirst();
      if (!row) return null;
      return {
        shortName: row.short_name,
        fullName: row.full_name,
        primaryColor: row.primary_color,
        logoPath: row.logo_path,
        address: row.address,
        phone: row.phone,
        email: row.email,
        motto: row.motto,
        website: row.website,
        principalName: row.principal_name,
        updatedAt: row.updated_at,
      };
    });
  }

  update(changes: SchoolSettingsChanges, now: string): Promise<void> {
    return guard(async () => {
      await this.db
        .updateTable('school_settings')
        .set({
          short_name: changes.shortName,
          full_name: changes.fullName,
          logo_path: changes.logoPath,
          address: changes.address,
          phone: changes.phone,
          email: changes.email,
          motto: changes.motto,
          website: changes.website,
          principal_name: changes.principalName,
          updated_at: now,
        })
        .where('id', '=', 'default')
        .execute();
    });
  }
}
