/**
 * TEST-ONLY seed for the browser end-to-end tests (apps/web/e2e).
 *
 * Recreates the database at DATABASE_URL from scratch (must be a sqlite file under apps/api/data
 * whose name contains "e2e"), migrates it, and creates synthetic accounts with known test
 * passwords. Never run against a real database.
 */
import { rmSync } from 'node:fs';
import { createAppDependencies } from '../../src/composition.js';
import { loadConfig } from '../../src/config/config.js';
import { createKysely } from '../../src/data/kysely/connection.js';
import { KyselyDataStore } from '../../src/data/kysely/kysely-data-store.js';
import {
  assignClassTeacher,
  createSchoolStructure,
  enrol,
  linkStudent,
  linkTeacher,
  seedAccount,
} from '../support/auth-fixtures.js';

export const E2E_PASSWORD = 'E2e-test-pass-1';
export const E2E_TEMPORARY_PASSWORD = 'Temp-e2e-pass-9';

const config = loadConfig();
if (config.database.driver !== 'sqlite' || !/e2e[^/]*\.sqlite$/.test(config.database.filename)) {
  console.error('[e2e-seed] refusing: DATABASE_URL must be a sqlite file named *e2e*.sqlite');
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm'])
  rmSync(config.database.filename + suffix, { force: true });

const db = await createKysely(config.database);
const store = new KyselyDataStore(db);
await store.schema.migrateToLatest();
const deps = createAppDependencies(config, store);

const school = await createSchoolStructure(db);
await seedAccount(deps, { username: 'e2e.admin', role: 'ADMIN', password: E2E_PASSWORD });
await linkTeacher(
  db,
  await seedAccount(deps, { username: 'e2e.teacher', role: 'TEACHER', password: E2E_PASSWORD }),
  'Test Subject Teacher',
);
const classTeacher = await linkTeacher(
  db,
  await seedAccount(deps, {
    username: 'e2e.classteacher',
    role: 'TEACHER',
    password: E2E_PASSWORD,
  }),
  'Test Class Teacher',
);
await assignClassTeacher(db, classTeacher, school.yearId, school.sectionA);
const student = await linkStudent(
  db,
  await seedAccount(deps, { username: 'e2e.student', role: 'STUDENT', password: E2E_PASSWORD }),
  'Test Student',
);
await enrol(db, student, school.yearId, school.sectionA);
await seedAccount(deps, {
  username: 'e2e.newuser',
  role: 'TEACHER',
  password: E2E_TEMPORARY_PASSWORD,
  temporary: true,
});

await store.close();
console.log('[e2e-seed] test database ready');
