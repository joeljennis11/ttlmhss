/**
 * Account administration CLI (operators only — runs on the server, not over HTTP).
 *
 *   pnpm account create-admin <username>    create an ADMIN login with a temporary password
 *   pnpm account reset-password <username>  issue a new temporary password, sign out everywhere
 *   pnpm account deactivate <username>      block sign-in and end all sessions
 *   pnpm account activate <username>
 *
 * There is no public registration: this is how the first Administrator gets an account. The
 * temporary password is printed ONCE here and must be changed at first sign-in. Teacher and
 * student accounts are created by Admin workflows in later phases.
 */
import { UsernameSchema } from '@ttlmhss/shared';
import { createAccountCredentialsService, createAppDependencies } from '../composition.js';
import { ConfigError, loadConfig } from '../config/config.js';
import { describeDatabase } from '../config/database-url.js';
import { AppError } from '../core/errors/app-errors.js';
import { openDataStore } from '../data/index.js';

const COMMANDS = ['create-admin', 'reset-password', 'deactivate', 'activate'] as const;
type Command = (typeof COMMANDS)[number];

function printTemporary(username: string, password: string) {
  console.log('');
  console.log(`  Username:            ${username}`);
  console.log(`  Temporary password:  ${password}`);
  console.log('');
  console.log('  Give this to the user privately. It is shown only once and must be changed');
  console.log('  at first sign-in.');
}

async function main(): Promise<number> {
  const [command, rawUsername] = process.argv.slice(2) as [Command | undefined, string | undefined];
  if (!command || !COMMANDS.includes(command) || !rawUsername) {
    console.error(`Usage: account <${COMMANDS.join('|')}> <username>`);
    return 2;
  }
  const parsedUsername = UsernameSchema.safeParse(rawUsername);
  if (!parsedUsername.success) {
    console.error(`Invalid username: ${parsedUsername.error.issues[0]?.message}`);
    return 2;
  }
  const username = parsedUsername.data;

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  console.log(`[account] ${config.env} → ${describeDatabase(config.database)}`);
  const store = await openDataStore(config.database);
  try {
    const pending = await store.schema.pending();
    if (pending.length > 0) {
      console.error('[account] database is not migrated — run `pnpm db:migrate` first');
      return 1;
    }
    const deps = createAppDependencies(config, store);
    const accounts = createAccountCredentialsService(deps);

    if (command === 'create-admin') {
      const created = await accounts.createAccount({ username, role: 'ADMIN' }, 'system');
      console.log(`[account] created ADMIN account "${created.username}"`);
      printTemporary(created.username, created.temporaryPassword);
      return 0;
    }

    const account = await store.repositories.userAccounts.findByUsername(username);
    if (!account) {
      console.error(`[account] no account named "${username}"`);
      return 1;
    }
    if (command === 'reset-password') {
      const issued = await accounts.issueTemporaryPassword(account.id, 'system');
      console.log(`[account] new temporary password issued; all sessions of "${username}" ended`);
      printTemporary(issued.username, issued.temporaryPassword);
    } else {
      const status = command === 'deactivate' ? 'INACTIVE' : 'ACTIVE';
      await accounts.setStatus(account.id, status, 'system');
      console.log(`[account] "${username}" is now ${status}`);
    }
    return 0;
  } catch (error) {
    console.error('[account] failed:', error instanceof AppError ? error.message : error);
    return 1;
  } finally {
    await store.close();
  }
}

process.exitCode = await main();
