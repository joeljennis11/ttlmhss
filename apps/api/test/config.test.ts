import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/config.js';
import { describeDatabase, parseDatabaseUrl } from '../src/config/database-url.js';

const base = { NODE_ENV: 'test', DATABASE_URL: 'sqlite::memory:' };

describe('configuration', () => {
  it('loads a valid configuration with defaults', () => {
    const config = loadConfig({ readEnvFiles: false, env: base });
    expect(config).toMatchObject({
      env: 'test',
      isProduction: false,
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      database: { driver: 'sqlite', filename: ':memory:' },
      corsOrigins: [],
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('parses comma-separated CORS origins', () => {
    const config = loadConfig({
      readEnvFiles: false,
      env: { ...base, CORS_ORIGINS: 'http://a.test, http://b.test,' },
    });
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('reports every problem and refuses to start', () => {
    expect(() =>
      loadConfig({ readEnvFiles: false, env: { NODE_ENV: 'staging', PORT: 'abc' } }),
    ).toThrow(ConfigError);
    try {
      loadConfig({ readEnvFiles: false, env: { NODE_ENV: 'staging', PORT: 'abc' } });
    } catch (error) {
      const problems = (error as ConfigError).problems.join('\n');
      expect(problems).toContain('NODE_ENV');
      expect(problems).toContain('PORT');
      expect(problems).toContain('DATABASE_URL');
    }
  });

  it('never echoes the database URL (it may contain credentials)', () => {
    try {
      loadConfig({
        readEnvFiles: false,
        env: { ...base, DATABASE_URL: 'mysql://admin:s3cret@db/x' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cret');
      expect((error as Error).message).toContain('DATABASE_URL');
    }
  });

  it('applies production safety rules', () => {
    const attempt = () =>
      loadConfig({
        readEnvFiles: false,
        env: { NODE_ENV: 'production', DATABASE_URL: 'sqlite::memory:' },
      });
    expect(attempt).toThrow(/in-memory database is not allowed/);
    expect(attempt).toThrow(/CORS_ORIGINS/);
  });

  it('resolves relative SQLite paths against the API directory, and describes postgres without secrets', () => {
    expect(parseDatabaseUrl('sqlite:./data/x.sqlite', '/srv/api')).toEqual({
      driver: 'sqlite',
      filename: path.resolve('/srv/api', 'data/x.sqlite'),
    });
    const pg = parseDatabaseUrl('postgres://user:pw@db.local:5433/ttlmhss', '/srv/api');
    expect(pg.driver).toBe('postgres');
    expect(describeDatabase(pg)).toBe('postgres (db.local:5433/ttlmhss)');
  });

  describe('.env files', () => {
    let dir: string;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('real environment > .env.<mode>.local > .env.<mode> > .env', () => {
      dir = mkdtempSync(path.join(tmpdir(), 'ttlmhss-env-'));
      writeFileSync(path.join(dir, '.env'), 'PORT=1111\nLOG_LEVEL=debug\nHOST=0.0.0.0\n');
      writeFileSync(
        path.join(dir, '.env.test'),
        'PORT=2222\nDATABASE_URL=sqlite::memory:\nLOG_LEVEL=warn\n',
      );
      writeFileSync(path.join(dir, '.env.test.local'), 'PORT=3333\n');

      const config = loadConfig({
        baseDirectory: dir,
        env: { NODE_ENV: 'test', LOG_LEVEL: 'error' },
      });
      expect(config.port).toBe(3333); // .env.test.local beats .env.test and .env
      expect(config.logLevel).toBe('error'); // real environment wins
      expect(config.host).toBe('0.0.0.0'); // falls through to .env
    });
  });
});
