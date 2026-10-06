/**
 * A generated file (PDF report, XLSX export) returned by a route handler instead of JSON.
 * `defineRoute` sends it as the raw body with a safe download name and `Cache-Control: no-store`
 * (reports contain personal data). Only the bytes travel — nothing is stored or logged.
 */
export class FileResponse {
  constructor(
    readonly body: Buffer,
    readonly contentType: string,
    readonly fileName: string,
  ) {}
}

export const PDF = 'application/pdf';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Letters, digits, "-" and "_" only (file names never carry other characters). */
export function safeFilePart(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'report'
  );
}
