import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export type RawEnv = Record<string, string | undefined>;

/**
 * Merge environment sources. Precedence (first wins):
 *   real environment → .env.<mode>.local → .env.<mode> → .env
 *
 * Files are optional. Production deployments are expected to rely on the real environment only;
 * .env.production is git-ignored and should not be used to hold secrets in the repository.
 */
export function loadEnvFiles(directory: string, processEnv: RawEnv): RawEnv {
  const mode = processEnv.NODE_ENV ?? 'development';
  const files = [`.env.${mode}.local`, `.env.${mode}`, '.env'];
  const merged: RawEnv = {};

  for (const file of files.reverse()) {
    const fullPath = path.join(directory, file);
    if (existsSync(fullPath)) {
      Object.assign(merged, parseEnv(readFileSync(fullPath, 'utf8')));
    }
  }
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
