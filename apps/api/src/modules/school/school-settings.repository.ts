/** School identity and contact details. Single record, edited by Admin (Phase 4). */
export interface SchoolSettings {
  shortName: string;
  fullName: string;
  primaryColor: string;
  /** Public path of the official logo (a file under /brand/). Never a placeholder. */
  logoPath: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  motto: string | null;
  website: string | null;
  principalName: string | null;
  updatedAt: string;
}

export type SchoolSettingsChanges = Omit<SchoolSettings, 'primaryColor' | 'updatedAt'>;

export interface SchoolSettingsRepository {
  get(): Promise<SchoolSettings | null>;
  update(changes: SchoolSettingsChanges, now: string): Promise<void>;
}
