import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../../config/config.js';

/**
 * Paths removed from every log line. Request headers are not logged by default; these are a
 * safety net for anything that adds them, and for objects passed to log calls.
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'passwordHash',
  'token',
  '*.password',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.secret',
];

export function buildLoggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' },
    ...(config.env === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}
