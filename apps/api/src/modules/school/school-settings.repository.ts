/** Public school identity and contact details. Single record, edited by Admin (Phase 4). */
export interface SchoolSettings {
  shortName: string;
  fullName: string;
  primaryColor: string;
  /** Public path of the OFFICIAL logo once supplied. Null until then — never a placeholder. */
  logoPath: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  updatedAt: string;
}

export interface SchoolSettingsRepository {
  get(): Promise<SchoolSettings | null>;
}
