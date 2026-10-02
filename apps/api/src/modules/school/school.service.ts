import type { SchoolBranding } from '@ttlmhss/shared';
import { InternalError } from '../../core/errors/app-errors.js';
import type { SchoolSettingsRepository } from './school-settings.repository.js';

export class SchoolService {
  constructor(private readonly settings: SchoolSettingsRepository) {}

  /** Public identity for the web shell, login page and documents. Contains nothing sensitive. */
  async getBranding(): Promise<SchoolBranding> {
    const settings = await this.settings.get();
    if (!settings) {
      // The identity row is created by migration 0002; absence means the schema is not migrated.
      throw new InternalError('School settings missing — run database migrations');
    }
    return {
      shortName: settings.shortName,
      fullName: settings.fullName,
      primaryColor: settings.primaryColor,
      logoUrl: settings.logoPath,
    };
  }
}
