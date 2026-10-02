import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  DatabaseUrlError,
  SQLITE_MEMORY,
  parseDatabaseUrl,
  type DatabaseConfig,
} from './database-url.js';
import { loadEnvFiles, type RawEnv } from './env-files.js';

/** apps/api — same depth from src/config and dist/config. */
export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const RUNTIME_ENVS = ['development', 'test', 'production'] as const;
export type RuntimeEnv = (typeof RUNTIME_ENVS)[number];

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const EnvSchema = z.object({
  NODE_ENV: z.enum(RUNTIME_ENVS).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: z.string().trim().min(1, { message: 'is required' }),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export interface AppConfig {
  readonly env: RuntimeEnv;
  readonly isProduction: boolean;
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly database: DatabaseConfig;
  readonly corsOrigins: readonly string[];
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigOptions {
  /** Environment to read. Defaults to process.env. */
  env?: RawEnv;
  /** Read .env files from the API directory. Defaults to true. */
  readEnvFiles?: boolean;
  /** Directory containing .env files and the base for relative SQLite paths. Defaults to apps/api. */
  baseDirectory?: string;
}

/**
 * Load and validate configuration once at startup. Invalid configuration stops the process with
 * a list of problems. Values are never echoed (they may contain credentials).
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const baseDirectory = options.baseDirectory ?? API_ROOT;
  const source = options.env ?? process.env;
  const raw = options.readEnvFiles === false ? source : loadEnvFiles(baseDirectory, source);

  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  const env = parsed.data;
  const problems: string[] = [];

  let database: DatabaseConfig | undefined;
  try {
    database = parseDatabaseUrl(env.DATABASE_URL, baseDirectory);
  } catch (error) {
    problems.push(
      `DATABASE_URL: ${error instanceof DatabaseUrlError ? error.message : 'could not be parsed'}`,
    );
  }

  if (env.NODE_ENV === 'production') {
    if (database?.driver === 'sqlite' && database.filename === SQLITE_MEMORY) {
      problems.push('DATABASE_URL: an in-memory database is not allowed in production');
    }
    if (env.CORS_ORIGINS.length === 0) {
      problems.push('CORS_ORIGINS: must list the web app origin(s) in production');
    }
  }

  if (problems.length > 0 || !database) throw new ConfigError(problems);

  return Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    database,
    corsOrigins: Object.freeze([...env.CORS_ORIGINS]),
  });
}
