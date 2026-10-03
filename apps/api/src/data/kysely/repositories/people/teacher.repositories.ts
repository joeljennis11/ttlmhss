import { RecordStatus, type Gender } from '@ttlmhss/shared';
import { sql, type Kysely } from 'kysely';
import type {
  ClassTeacherRecord,
  ClassTeacherRepository,
  LinkedAccount,
  PersonAccountRepository,
  SubjectRef,
  TeacherDetailsRecord,
  TeacherListFilter,
  TeacherRecord,
  TeacherRepository,
  TeacherSubjectRepository,
} from '../../../../modules/people/people.repository.js';
import type { Database, TeachersTable } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { controlled, lowerEquals } from '../config/structure.repositories.js';
import { likePattern } from './student.repositories.js';

const GENDERS = new Set(['MALE', 'FEMALE', 'OTHER']);

function toTeacher(row: TeachersTable): TeacherRecord {
  return {
    id: row.id,
    userId: row.user_id,
    staffCode: row.staff_code,
    fullName: row.full_name,
    gender: row.gender && GENDERS.has(row.gender) ? (row.gender as Gender) : null,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    email: row.email,
    address: row.address,
    designation: row.designation,
    qualification: row.qualification,
    joiningDate: row.joining_date,
    status: controlled(RecordStatus, row.status, 'teacher status'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const detailColumns = (d: TeacherDetailsRecord) => ({
  full_name: d.fullName,
  gender: d.gender,
  date_of_birth: d.dateOfBirth,
  phone: d.phone,
  email: d.email,
  address: d.address,
  designation: d.designation,
  qualification: d.qualification,
  joining_date: d.joiningDate,
});

export class KyselyTeacherRepository implements TeacherRepository {
  constructor(private readonly db: Kysely<Database>) {}

  find(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('teachers')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toTeacher(row) : null;
    });
  }

  findByStaffCode(staffCode: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('teachers')
        .selectAll()
        .where(lowerEquals('staff_code', staffCode.trim()))
        .executeTakeFirst();
      return row ? toTeacher(row) : null;
    });
  }

  create(t: TeacherDetailsRecord & { id: string; userId: string; staffCode: string }, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('teachers')
        .values({
          id: t.id,
          user_id: t.userId,
          staff_code: t.staffCode,
          status: 'ACTIVE',
          ...detailColumns(t),
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateDetails(id: string, details: TeacherDetailsRecord, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('teachers')
        .set({ ...detailColumns(details), updated_at: now })
        .where('id', '=', id)
        .execute();
    });
  }

  setStatus(id: string, status: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('teachers')
        .set({ status, updated_at: now })
        .where('id', '=', id)
        .execute();
    });
  }

  list(f: TeacherListFilter) {
    return guard(async () => {
      let base = this.db.selectFrom('teachers as t');
      if (f.q) {
        const pattern = likePattern(f.q);
        base = base.where((eb) =>
          eb.or([
            eb(sql`lower(t.full_name)`, 'like', sql`${pattern} escape '\\'`),
            eb(sql`lower(t.staff_code)`, 'like', sql`${pattern} escape '\\'`),
          ]),
        );
      }
      if (f.status !== 'ALL') base = base.where('t.status', '=', f.status);
      if (f.designation) base = base.where(lowerEquals('t.designation', f.designation));
      if (f.subjectId) {
        const subjectId = f.subjectId;
        base = base.where((eb) =>
          eb.exists(
            eb
              .selectFrom('teacher_subjects as ts')
              .select('ts.teacher_id')
              .whereRef('ts.teacher_id', '=', 't.id')
              .where('ts.subject_id', '=', subjectId),
          ),
        );
      }
      const countRow = await base
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      const rows = await base
        .selectAll('t')
        .orderBy('t.full_name')
        .orderBy('t.staff_code')
        .limit(f.limit)
        .offset(f.offset)
        .execute();
      return { rows: rows.map(toTeacher), total: Number(countRow.n) };
    });
  }

  designations() {
    return guard(async () => {
      const rows = await this.db
        .selectFrom('teachers')
        .select('designation')
        .distinct()
        .where('designation', 'is not', null)
        .orderBy('designation')
        .execute();
      return rows.map((r) => r.designation).filter((d): d is string => Boolean(d));
    });
  }

  delete(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('teachers').where('id', '=', id).execute();
    });
  }
}

export class KyselyTeacherSubjectRepository implements TeacherSubjectRepository {
  constructor(private readonly db: Kysely<Database>) {}

  forTeachers(teacherIds: string[]) {
    return guard(async () => {
      const map = new Map<string, SubjectRef[]>();
      for (const id of teacherIds) map.set(id, []);
      if (teacherIds.length === 0) return map;
      const rows = await this.db
        .selectFrom('teacher_subjects as ts')
        .innerJoin('subjects as s', 's.id', 'ts.subject_id')
        .select(['ts.teacher_id', 's.id', 's.name', 's.code', 's.status'])
        .where('ts.teacher_id', 'in', teacherIds)
        .orderBy('s.display_order')
        .orderBy('s.name')
        .execute();
      for (const r of rows) {
        map.get(r.teacher_id)?.push({
          id: r.id,
          name: r.name,
          code: r.code,
          status: controlled(RecordStatus, r.status, 'subject status'),
        });
      }
      return map;
    });
  }

  exists(teacherId: string, subjectId: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('teacher_subjects')
        .select('teacher_id')
        .where('teacher_id', '=', teacherId)
        .where('subject_id', '=', subjectId)
        .executeTakeFirst();
      return row !== undefined;
    });
  }

  add(teacherId: string, subjectId: string, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('teacher_subjects')
        .values({ teacher_id: teacherId, subject_id: subjectId, created_at: now })
        .execute();
    });
  }

  remove(teacherId: string, subjectId: string) {
    return guard(async () => {
      await this.db
        .deleteFrom('teacher_subjects')
        .where('teacher_id', '=', teacherId)
        .where('subject_id', '=', subjectId)
        .execute();
    });
  }

  deleteForTeacher(teacherId: string) {
    return guard(async () => {
      await this.db.deleteFrom('teacher_subjects').where('teacher_id', '=', teacherId).execute();
    });
  }
}

function classTeacherQuery(db: Kysely<Database>) {
  return db
    .selectFrom('class_teacher_assignments as a')
    .innerJoin('teachers as t', 't.id', 'a.teacher_id')
    .innerJoin('academic_years as y', 'y.id', 'a.academic_year_id')
    .innerJoin('sections as sec', 'sec.id', 'a.section_id')
    .innerJoin('classes as c', 'c.id', 'sec.class_id')
    .select([
      'a.id',
      'a.teacher_id',
      't.full_name as teacher_name',
      't.staff_code',
      'a.academic_year_id',
      'y.label as year_label',
      'c.id as class_id',
      'c.name as class_name',
      'sec.id as section_id',
      'sec.name as section_name',
      'a.status',
      'a.assigned_on',
      'a.ended_on',
    ]);
}

function toClassTeacher(r: {
  id: string;
  teacher_id: string;
  teacher_name: string;
  staff_code: string;
  academic_year_id: string;
  year_label: string;
  class_id: string;
  class_name: string;
  section_id: string;
  section_name: string;
  status: string;
  assigned_on: string;
  ended_on: string | null;
}): ClassTeacherRecord {
  return {
    id: r.id,
    teacherId: r.teacher_id,
    teacherName: r.teacher_name,
    staffCode: r.staff_code,
    academicYearId: r.academic_year_id,
    academicYearLabel: r.year_label,
    classId: r.class_id,
    className: r.class_name,
    sectionId: r.section_id,
    sectionName: r.section_name,
    status: controlled(RecordStatus, r.status, 'assignment status'),
    assignedOn: r.assigned_on,
    endedOn: r.ended_on,
  };
}

export class KyselyClassTeacherRepository implements ClassTeacherRepository {
  constructor(private readonly db: Kysely<Database>) {}

  find(id: string) {
    return guard(async () => {
      const row = await classTeacherQuery(this.db).where('a.id', '=', id).executeTakeFirst();
      return row ? toClassTeacher(row) : null;
    });
  }

  forTeacher(teacherId: string) {
    return guard(async () => {
      const rows = await classTeacherQuery(this.db)
        .where('a.teacher_id', '=', teacherId)
        .orderBy('y.start_date', 'desc')
        .orderBy('a.assigned_on', 'desc')
        .orderBy('a.created_at', 'desc')
        .execute();
      return rows.map(toClassTeacher);
    });
  }

  activeInYear(academicYearId: string, teacherIds?: string[]) {
    return guard(async () => {
      let query = classTeacherQuery(this.db)
        .where('a.academic_year_id', '=', academicYearId)
        .where('a.status', '=', 'ACTIVE');
      if (teacherIds)
        query = query.where('a.teacher_id', 'in', teacherIds.length ? teacherIds : ['']);
      const rows = await query.orderBy('c.display_order').orderBy('sec.name').execute();
      return rows.map(toClassTeacher);
    });
  }

  findActiveForSection(academicYearId: string, sectionId: string) {
    return guard(async () => {
      const row = await classTeacherQuery(this.db)
        .where('a.academic_year_id', '=', academicYearId)
        .where('a.section_id', '=', sectionId)
        .where('a.status', '=', 'ACTIVE')
        .executeTakeFirst();
      return row ? toClassTeacher(row) : null;
    });
  }

  create(
    a: {
      id: string;
      teacherId: string;
      academicYearId: string;
      sectionId: string;
      assignedOn: string;
    },
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('class_teacher_assignments')
        .values({
          id: a.id,
          teacher_id: a.teacherId,
          academic_year_id: a.academicYearId,
          section_id: a.sectionId,
          status: 'ACTIVE',
          assigned_on: a.assignedOn,
          ended_on: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  end(id: string, endedOn: string, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('class_teacher_assignments')
        .set({ status: 'INACTIVE', ended_on: endedOn, updated_at: now })
        .where('id', '=', id)
        .where('status', '=', 'ACTIVE')
        .execute();
    });
  }

  countForTeacher(teacherId: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('class_teacher_assignments')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('teacher_id', '=', teacherId)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    });
  }
}

export class KyselyPersonAccountRepository implements PersonAccountRepository {
  constructor(private readonly db: Kysely<Database>) {}

  find(userId: string) {
    return guard(async (): Promise<LinkedAccount | null> => {
      const row = await this.db
        .selectFrom('users as u')
        .leftJoin('user_credentials as c', 'c.user_id', 'u.id')
        .select(['u.id', 'u.username', 'u.status', 'c.password_status', 'c.last_login_at'])
        .where('u.id', '=', userId)
        .executeTakeFirst();
      if (!row) return null;
      return {
        userId: row.id,
        username: row.username,
        status: controlled(RecordStatus, row.status, 'user status'),
        mustChangePassword: row.password_status !== 'SET',
        lastLoginAt: row.last_login_at ?? null,
      };
    });
  }

  isUnused(userId: string) {
    return guard(async () => {
      const cred = await this.db
        .selectFrom('user_credentials')
        .select('last_login_at')
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (cred?.last_login_at) return false;
      const acted = await this.db
        .selectFrom('audit_logs')
        .select('id')
        .where('actor_user_id', '=', userId)
        .executeTakeFirst();
      if (acted) return false;
      const enrolmentRefs = await this.db
        .selectFrom('enrolments')
        .select('id')
        .where((eb) => eb.or([eb('created_by', '=', userId), eb('closed_by', '=', userId)]))
        .executeTakeFirst();
      return enrolmentRefs === undefined;
    });
  }

  delete(userId: string) {
    return guard(async () => {
      await this.db.deleteFrom('sessions').where('user_id', '=', userId).execute();
      await this.db.deleteFrom('user_credentials').where('user_id', '=', userId).execute();
      await this.db.deleteFrom('users').where('id', '=', userId).execute();
    });
  }
}
