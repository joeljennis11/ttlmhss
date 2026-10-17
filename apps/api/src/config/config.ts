import { randomBytes } from 'node:crypto';
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

// Accepts true/false in any letter case with surrounding spaces (a common dashboard typo).
const booleanFlag = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
);

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
  TRUST_PROXY: booleanFlag.optional(),
  /**
   * SMS provider for staff phone verification (Phase 12C, D-125). Only 'none' exists in this
   * version: no SMS is ever sent and no OTP flow is offered; the temporary-password onboarding
   * remains the way staff receive access.
   */
  SMS_PROVIDER: z.string().trim().default('none'),

  // ---- Authentication (Phase 2) ----
  /** HMAC key for session-token hashing. Required in production; generated per process otherwise. */
  SESSION_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32, { message: 'must be at least 32 characters' }).optional(),
  ),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(120),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  /** Defaults to true in production, false otherwise (plain-http development). */
  COOKIE_SECURE: booleanFlag.optional(),
  /** Sign-in requests per minute per client address (a school network shares one; D-121). */
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(60),
  /** Failed sign-ins for one username from one address before that address is locked. */
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  /** Failed sign-ins for one username from all addresses before unknown addresses are locked. */
  LOGIN_ACCOUNT_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(2).max(1000).default(20),
  LOGIN_LOCKOUT_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(15),
});

/** A configured web origin: scheme + host (+ port), nothing else. Returns a problem or null. */
function originProblem(origin: string, production: boolean): string | null {
  if (origin === '*' || origin.includes('*')) return 'wildcards are not allowed';
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return 'each entry must be an origin such as https://school.example';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return 'only http(s) origins are allowed';
  if (url.origin !== origin) {
    return 'each entry must be an origin only (no path, query or credentials)';
  }
  if (production && url.protocol !== 'https:') return 'production origins must use https';
  return null;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Running on Vercel (the platform sets VERCEL=1 for builds and functions). */
export function onVercel(raw: RawEnv): boolean {
  return raw.VERCEL === '1';
}

/** Obvious placeholders and low-entropy values that pass the length check but are not secret. */
export function weakSecretProblem(secret: string): string | null {
  if (new Set(secret).size < 12) return 'is too repetitive; generate a random value';
  if (/change.?me|placeholder|example|your.?secret|replace|dummy|default/i.test(secret)) {
    return 'looks like a placeholder; generate a random value';
  }
  return null;
}

export interface AuthConfig {
  /** Never log or return this. */
  readonly sessionSecret: string;
  /** True when no SESSION_SECRET was configured (development/test only): sessions end on restart. */
  readonly sessionSecretIsEphemeral: boolean;
  readonly idleTimeoutMs: number;
  readonly absoluteTimeoutMs: number;
  readonly cookieSecure: boolean;
  readonly loginRateLimitPerMinute: number;
  readonly maxFailedAttempts: number;
  readonly accountMaxFailedAttempts: number;
  readonly lockoutMs: number;
}

export interface AppConfig {
  readonly env: RuntimeEnv;
  readonly isProduction: boolean;
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly database: DatabaseConfig;
  readonly corsOrigins: readonly string[];
  /** Trust X-Forwarded-* headers (only behind a known reverse proxy). */
  readonly trustProxy: boolean;
  /** Deployed on Vercel (ingress only through Vercel's edge). */
  readonly vercel: boolean;
  /** Send Strict-Transport-Security: only when the site is served over HTTPS (secure cookies). */
  readonly hsts: boolean;
  readonly auth: AuthConfig;
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
  // Vercel (Phase 12C, D-129): the platform supplies what a server operator would set by hand —
  // the site address (system variable VERCEL_PROJECT_PRODUCTION_URL) and an edge that overwrites
  // X-Forwarded-For. Explicit values still win.
  if (onVercel(raw)) {
    if (env.TRUST_PROXY === undefined) env.TRUST_PROXY = true;
    const site = raw.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    if (env.CORS_ORIGINS.length === 0 && site) env.CORS_ORIGINS = [`https://${site}`];
  }
  const problems: string[] = [];

  let database: DatabaseConfig | undefined;
  try {
    database = parseDatabaseUrl(env.DATABASE_URL, baseDirectory);
  } catch (error) {
    problems.push(
      `DATABASE_URL: ${error instanceof DatabaseUrlError ? error.message : 'could not be parsed'}`,
    );
  }

  const production = env.NODE_ENV === 'production';
  for (const origin of env.CORS_ORIGINS) {
    const problem = originProblem(origin, production);
    if (problem) {
      problems.push(`CORS_ORIGINS: ${problem}`);
      break;
    }
  }

  if (env.SMS_PROVIDER !== 'none') {
    problems.push(
      "SMS_PROVIDER: no SMS provider integration is available in this version; leave it unset or 'none' (see docs/deployment.md)",
    );
  }

  if (production) {
    if (env.TRUST_PROXY === undefined) {
      problems.push(
        'TRUST_PROXY: must be set explicitly in production (true behind the documented reverse proxy, false when clients connect directly)',
      );
    }
    // On Vercel the API is reachable only through Vercel's edge, which sets X-Forwarded-For
    // itself; elsewhere only a proxy on the same host may be trusted.
    if (env.TRUST_PROXY === true && !LOOPBACK.has(env.HOST) && !onVercel(raw)) {
      problems.push(
        'TRUST_PROXY: true requires HOST to be a loopback address (127.0.0.1) so that only the local reverse proxy can reach the API and forwarded addresses cannot be forged',
      );
    }
    if (database?.driver === 'sqlite' && onVercel(raw)) {
      problems.push(
        'DATABASE_URL: SQLite cannot be used on Vercel (function storage is temporary and data would be lost); use a PostgreSQL connection string',
      );
    }
    if (database?.driver === 'sqlite' && database.filename === SQLITE_MEMORY) {
      problems.push('DATABASE_URL: an in-memory database is not allowed in production');
    }
    if (env.CORS_ORIGINS.length === 0) {
      problems.push('CORS_ORIGINS: must list the web app origin(s) in production');
    }
    if (!env.SESSION_SECRET) {
      problems.push('SESSION_SECRET: is required in production (at least 32 random characters)');
    } else {
      const weak = weakSecretProblem(env.SESSION_SECRET);
      if (weak) problems.push(`SESSION_SECRET: ${weak}`);
    }
    if (env.COOKIE_SECURE === false) {
      problems.push('COOKIE_SECURE: cannot be false in production (serve the site over HTTPS)');
    }
  }
  if (env.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 < env.SESSION_IDLE_TIMEOUT_MINUTES) {
    problems.push('SESSION_IDLE_TIMEOUT_MINUTES: must not exceed the absolute session timeout');
  }

  if (problems.length > 0 || !database) throw new ConfigError(problems);

  const cookieSecure = env.COOKIE_SECURE ?? production;
  return Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    database,
    corsOrigins: Object.freeze([...env.CORS_ORIGINS]),
    trustProxy: env.TRUST_PROXY ?? false,
    vercel: onVercel(raw),
    hsts: cookieSecure,
    auth: Object.freeze({
      sessionSecret: env.SESSION_SECRET ?? randomBytes(32).toString('base64url'),
      sessionSecretIsEphemeral: !env.SESSION_SECRET,
      idleTimeoutMs: env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000,
      absoluteTimeoutMs: env.SESSION_ABSOLUTE_TIMEOUT_HOURS * 3_600_000,
      cookieSecure,
      loginRateLimitPerMinute: env.LOGIN_RATE_LIMIT_PER_MINUTE,
      maxFailedAttempts: env.LOGIN_MAX_FAILED_ATTEMPTS,
      accountMaxFailedAttempts: env.LOGIN_ACCOUNT_MAX_FAILED_ATTEMPTS,
      lockoutMs: env.LOGIN_LOCKOUT_MINUTES * 60_000,
    }),
  });
}
