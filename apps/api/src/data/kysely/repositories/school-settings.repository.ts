import type { Kysely } from 'kysely';
import type {
  SchoolSettings,
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
        updatedAt: row.updated_at,
      };
    });
  }
}
