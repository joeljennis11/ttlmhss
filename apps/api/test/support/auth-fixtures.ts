import { randomUUID } from 'node:crypto';
import type { RecordStatus, UserRole } from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import type { AppDependencies } from '../../src/app-dependencies.js';
import type { Database } from '../../src/data/kysely/database-schema.js';

/*
 * TEST FIXTURES ONLY. Synthetic accounts and school structure created in throwaway in-memory
 * databases to exercise authentication and scope rules. Names are obviously fake.
 * Profile rows (teachers/students/enrolments/assignments) are inserted directly because their
 * management features belong to later phases.
 */
const NOW = '2026-06-01T09:00:00.000Z';
const ts = { created_at: NOW, updated_at: NOW };

export const PASSWORD = 'Correct-horse-42';

export async function seedAccount(
  deps: AppDependencies,
  input: {
    username: string;
    role: UserRole;
    password?: string | null;
    temporary?: boolean;
    status?: RecordStatus;
  },
): Promise<string> {
  const id = randomUUID();
  const repos = deps.dataStore.repositories;
  await repos.userAccounts.create(
    { id, username: input.username, role: input.role, status: input.status ?? 'ACTIVE' },
    NOW,
  );
  if (input.password !== null) {
    const hash = await deps.passwordHasher.hash(input.password ?? PASSWORD);
    await repos.credentials.save(id, hash, input.temporary ? 'TEMPORARY' : 'SET', NOW);
  }
  return id;
}

export async function linkTeacher(db: Kysely<Database>, userId: string, name = 'Test Teacher') {
  const id = randomUUID();
  await db
    .insertInto('teachers')
    .values({
      id,
      user_id: userId,
      staff_code: `T-${id.slice(0, 6)}`,
      full_name: name,
      phone: null,
      email: null,
      status: 'ACTIVE',
      ...ts,
    })
    .execute();
  return id;
}

export async function linkStudent(db: Kysely<Database>, userId: string, name = 'Test Student') {
  const id = randomUUID();
  await db
    .insertInto('students')
    .values({
      id,
      user_id: userId,
      admission_number: `A-${id.slice(0, 6)}`,
      full_name: name,
      date_of_birth: null,
      photo_path: null,
      status: 'ACTIVE',
      ...ts,
    })
    .execute();
  return id;
}

export async function createSchoolStructure(db: Kysely<Database>) {
  const yearId = randomUUID();
  const closedYearId = randomUUID();
  const classId = randomUUID();
  const sectionA = randomUUID();
  const sectionB = randomUUID();
  await db
    .insertInto('academic_years')
    .values([
      {
        id: closedYearId,
        label: 'TEST-PAST',
        start_date: '2025-06-01',
        end_date: '2026-04-30',
        status: 'CLOSED',
        ...ts,
      },
      {
        id: yearId,
        label: 'TEST-CURRENT',
        start_date: '2026-06-01',
        end_date: '2027-04-30',
        status: 'CURRENT',
        ...ts,
      },
    ])
    .execute();
  await db
    .insertInto('classes')
    .values({ id: classId, name: 'TEST-CLASS', display_order: 1, status: 'ACTIVE', ...ts })
    .execute();
  await db
    .insertInto('sections')
    .values([
      { id: sectionA, class_id: classId, name: 'A', status: 'ACTIVE', ...ts },
      { id: sectionB, class_id: classId, name: 'B', status: 'ACTIVE', ...ts },
    ])
    .execute();
  return { yearId, closedYearId, sectionA, sectionB };
}

export async function enrol(
  db: Kysely<Database>,
  studentId: string,
  yearId: string,
  sectionId: string,
) {
  await db
    .insertInto('enrolments')
    .values({
      id: randomUUID(),
      student_id: studentId,
      academic_year_id: yearId,
      section_id: sectionId,
      roll_number: null,
      status: 'ACTIVE',
      started_on: '2026-06-01',
      ended_on: null,
      ...ts,
    })
    .execute();
}

export async function assignClassTeacher(
  db: Kysely<Database>,
  teacherId: string,
  yearId: string,
  sectionId: string,
) {
  const id = randomUUID();
  await db
    .insertInto('class_teacher_assignments')
    .values({
      id,
      academic_year_id: yearId,
      section_id: sectionId,
      teacher_id: teacherId,
      status: 'ACTIVE',
      assigned_on: '2026-06-01',
      ended_on: null,
      ...ts,
    })
    .execute();
  return id;
}
