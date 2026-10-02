import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config/config.js';
import { describeDatabase } from './config/database-url.js';
import { createAppDependencies } from './composition.js';
import { openDataStore } from './data/index.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const dataStore = await openDataStore(config.database);
  const app = await buildApp(createAppDependencies(config, dataStore));

  if (config.auth.sessionSecretIsEphemeral) {
    app.log.warn(
      'SESSION_SECRET is not set: using a per-process secret, so everyone is signed out when the API restarts. Set it in apps/api/.env.development.local to keep sessions.',
    );
  }

  const pending = await dataStore.schema.pending();
  if (pending.length > 0) {
    app.log.fatal(
      { pending },
      'Database schema is not up to date. Run `pnpm db:migrate` before starting the API.',
    );
    await dataStore.close();
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await dataStore.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`env=${config.env} database=${describeDatabase(config.database)}`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Fatal startup error: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
