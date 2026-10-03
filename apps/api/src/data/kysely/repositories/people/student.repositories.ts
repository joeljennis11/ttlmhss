import { EnrolmentStatus, RecordStatus, type ExitReason, type Gender } from '@ttlmhss/shared';
import { sql, type Kysely } from 'kysely';
import type {
  EnrolmentRepository,
  NewEnrolment,
  NewStudent,
  PlacementRecord,
  StudentDetailsRecord,
  StudentListFilter,
  StudentListRow,
  StudentRecord,
  StudentRepository,
} from '../../../../modules/people/people.repository.js';
import type { Database, StudentsTable } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { controlled, lowerEquals } from '../config/structure.repositories.js';

const GENDERS = new Set(['MALE', 'FEMALE', 'OTHER']);
const EXITS = new Set(['TRANSFERRED', 'LEFT']);

export function toStudent(row: StudentsTable): StudentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    admissionNumber: row.admission_number,
    admissionDate: row.admission_date,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    gender: row.gender && GENDERS.has(row.gender) ? (row.gender as Gender) : null,
    fatherName: row.father_name,
    motherName: row.mother_name,
    guardianName: row.guardian_name,
    guardianRelation: row.guardian_relation,
    guardianPhone: row.guardian_phone,
    phone: row.phone,
    email: row.email,
    emergencyPhone: row.emergency_phone,
    address: row.address,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    photoPath: row.photo_path,
    status: controlled(RecordStatus, row.status, 'student status'),
    exitReason:
      row.exit_reason && EXITS.has(row.exit_reason) ? (row.exit_reason as ExitReason) : null,
    exitDate: row.exit_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const detailColumns = (d: StudentDetailsRecord) => ({
  full_name: d.fullName,
  date_of_birth: d.dateOfBirth,
  gender: d.gender,
  father_name: d.fatherName,
  mother_name: d.motherName,
  guardian_name: d.guardianName,
  guardian_relation: d.guardianRelation,
  guardian_phone: d.guardianPhone,
  phone: d.phone,
  email: d.email,
  emergency_phone: d.emergencyPhone,
  address: d.address,
  city: d.city,
  state: d.state,
  pincode: d.pincode,
});

// ---------------------------------------------------------------------------
// Placements (enrolment + names)
// ---------------------------------------------------------------------------

function placementQuery(db: Kysely<Database>) {
  return db
    .selectFrom('enrolments as e')
    .innerJoin('academic_years as y', 'y.id', 'e.academic_year_id')
    .innerJoin('sections as sec', 'sec.id', 'e.section_id')
    .innerJoin('classes as c', 'c.id', 'sec.class_id')
    .select([
      'e.id as enrolment_id',
      'e.student_id',
      'e.academic_year_id',
      'y.label as year_label',
      'y.start_date as year_start',
      'c.id as class_id',
      'c.name as class_name',
      'c.display_order as class_order',
      'sec.id as section_id',
      'sec.name as section_name',
      'e.roll_number',
      'e.status',
      'e.started_on',
      'e.ended_on',
    ]);
}

type PlacementRow = {
  enrolment_id: string;
  student_id: string;
  academic_year_id: string;
  year_label: string;
  year_start: string;
  class_id: string;
  class_name: string;
  class_order: number;
  section_id: string;
  section_name: string;
  roll_number: string | null;
  status: string;
  started_on: string;
  ended_on: string | null;
};

function toPlacement(row: PlacementRow): PlacementRecord {
  return {
    enrolmentId: row.enrolment_id,
    studentId: row.student_id,
    academicYearId: row.academic_year_id,
    academicYearLabel: row.year_label,
    academicYearStart: row.year_start,
    classId: row.class_id,
    className: row.class_name,
    classOrder: Number(row.class_order),
    sectionId: row.section_id,
    sectionName: row.section_name,
    rollNumber: row.roll_number,
    status: controlled(EnrolmentStatus, row.status, 'enrolment status'),
    startedOn: row.started_on,
    endedOn: row.ended_on,
  };
}

/** Sort key for roll numbers: numeric when the value is a number ("2" before "10"). */
const ROLL_ORDER = sql`case when e.roll_number is null then 1 else 0 end, length(e.roll_number), e.roll_number`;

export class KyselyEnrolmentRepository implements EnrolmentRepository {
  constructor(private readonly db: Kysely<Database>) {}

  find(id: string) {
    return guard(async () => {
      const row = await placementQuery(this.db).where('e.id', '=', id).executeTakeFirst();
      return row ? toPlacement(row) : null;
    });
  }

  listForStudent(studentId: string) {
    return guard(async () => {
      const rows = await placementQuery(this.db)
        .where('e.student_id', '=', studentId)
        .orderBy('y.start_date', 'desc')
        .orderBy('e.started_on', 'desc')
        .orderBy('e.created_at', 'desc')
        .execute();
      return rows.map(toPlacement);
    });
  }

  findActive(studentId: string, academicYearId: string) {
    return guard(async () => {
      const row = await placementQuery(this.db)
        .where('e.student_id', '=', studentId)
        .where('e.academic_year_id', '=', academicYearId)
        .where('e.status', '=', 'ACTIVE')
        .executeTakeFirst();
      return row ? toPlacement(row) : null;
    });
  }

  listForStudentInYear(studentId: string, academicYearId: string) {
    return guard(async () => {
      const rows = await placementQuery(this.db)
        .where('e.student_id', '=', studentId)
        .where('e.academic_year_id', '=', academicYearId)
        .orderBy('e.started_on', 'desc')
        .execute();
      return rows.map(toPlacement);
    });
  }

  listActiveInSection(academicYearId: string, sectionId: string) {
    return guard(async () => {
      const rows = await placementQuery(this.db)
        .innerJoin('students as s', 's.id', 'e.student_id')
        .select(['s.full_name', 's.admission_number'])
        .where('e.academic_year_id', '=', academicYearId)
        .where('e.section_id', '=', sectionId)
        .where('e.status', '=', 'ACTIVE')
        .orderBy(ROLL_ORDER)
        .orderBy('s.full_name')
        .execute();
      return rows.map((r) => ({
        ...toPlacement(r),
        fullName: r.full_name,
        admissionNumber: r.admission_number,
      }));
    });
  }

  placementsInYear(studentIds: string[], academicYearId: string) {
    return guard(async () => {
      const map = new Map<string, PlacementRecord>();
      if (studentIds.length === 0) return map;
      const rows = await placementQuery(this.db)
        .where('e.student_id', 'in', studentIds)
        .where('e.academic_year_id', '=', academicYearId)
        .orderBy('e.started_on', 'asc')
        .orderBy('e.created_at', 'asc')
        .execute();
      // Later rows win; an ACTIVE placement always wins.
      for (const row of rows) {
        const p = toPlacement(row);
        const existing = map.get(p.studentId);
        if (!existing || existing.status !== 'ACTIVE' || p.status === 'ACTIVE')
          map.set(p.studentId, p);
      }
      return map;
    });
  }

  rollNumberTaken(
    academicYearId: string,
    sectionId: string,
    rollNumber: string,
    exceptEnrolmentId?: string,
  ) {
    return guard(async () => {
      let query = this.db
        .selectFrom('enrolments')
        .select('id')
        .where('academic_year_id', '=', academicYearId)
        .where('section_id', '=', sectionId)
        .where('status', '=', 'ACTIVE')
        .where(lowerEquals('roll_number', rollNumber));
      if (exceptEnrolmentId) query = query.where('id', '<>', exceptEnrolmentId);
      return (await query.executeTakeFirst()) !== undefined;
    });
  }

  create(e: NewEnrolment, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('enrolments')
        .values({
          id: e.id,
          student_id: e.studentId,
          academic_year_id: e.academicYearId,
          section_id: e.sectionId,
          roll_number: e.rollNumber,
          status: 'ACTIVE',
          started_on: e.startedOn,
          ended_on: null,
          note: e.note,
          created_by: e.createdBy,
          closed_by: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  close(
    id: string,
    change: { status: string; endedOn: string; closedBy: string | null; note: string | null },
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .updateTable('enrolments')
        .set({
          status: change.status,
          ended_on: change.endedOn,
          closed_by: change.closedBy,
          ...(change.note ? { note: change.note } : {}),
          updated_at: now,
        })
        .where('id', '=', id)
        .where('status', '=', 'ACTIVE')
        .execute();
    });
  }

  countForStudent(studentId: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('enrolments')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('student_id', '=', studentId)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    });
  }

  deleteForStudent(studentId: string) {
    return guard(async () => {
      await this.db.deleteFrom('enrolments').where('student_id', '=', studentId).execute();
    });
  }
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/** LIKE pattern with wildcards escaped. */
export const likePattern = (q: string) =>
  `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export class KyselyStudentRepository implements StudentRepository {
  constructor(private readonly db: Kysely<Database>) {}

  find(id: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('students')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toStudent(row) : null;
    });
  }

  findByUserId(userId: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('students')
        .selectAll()
        .where('user_id', '=', userId)
        .executeTakeFirst();
      return row ? toStudent(row) : null;
    });
  }

  findByAdmissionNumber(admissionNumber: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('students')
        .selectAll()
        .where(lowerEquals('admission_number', admissionNumber.trim()))
        .executeTakeFirst();
      return row ? toStudent(row) : null;
    });
  }

  create(s: NewStudent, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('students')
        .values({
          id: s.id,
          user_id: s.userId,
          admission_number: s.admissionNumber,
          admission_date: s.admissionDate,
          photo_path: null,
          status: 'ACTIVE',
          exit_reason: null,
          exit_date: null,
          ...detailColumns(s),
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateDetails(id: string, details: StudentDetailsRecord, now: string) {
    return guard(async () => {
      await this.db
        .updateTable('students')
        .set({ ...detailColumns(details), updated_at: now })
        .where('id', '=', id)
        .execute();
    });
  }

  setStatus(
    id: string,
    status: string,
    exit: { reason: string; date: string } | null,
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .updateTable('students')
        .set({
          status,
          exit_reason: exit?.reason ?? null,
          exit_date: exit?.date ?? null,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  list(f: StudentListFilter) {
    return guard(async () => {
      // The placement shown for each student: their ACTIVE enrolment in the year, otherwise their
      // latest one in that year. Chosen with a correlated subquery (portable: SQLite + PostgreSQL).
      const pick = sql<string>`(
        select e2.id from enrolments e2
        where e2.student_id = s.id and e2.academic_year_id = ${f.academicYearId ?? ''}
        order by case when e2.status = 'ACTIVE' then 0 else 1 end, e2.started_on desc, e2.created_at desc
        limit 1)`;

      let base = this.db
        .selectFrom('students as s')
        .leftJoin('enrolments as e', (join) => join.on('e.id', '=', pick))
        .leftJoin('sections as sec', 'sec.id', 'e.section_id')
        .leftJoin('classes as c', 'c.id', 'sec.class_id');

      if (f.q) {
        const pattern = likePattern(f.q);
        base = base.where((eb) =>
          eb.or([
            eb(sql`lower(s.full_name)`, 'like', sql`${pattern} escape '\\'`),
            eb(sql`lower(s.admission_number)`, 'like', sql`${pattern} escape '\\'`),
          ]),
        );
      }
      if (f.status === 'ACTIVE') base = base.where('s.status', '=', 'ACTIVE');
      if (f.status === 'INACTIVE')
        base = base.where('s.status', '=', 'INACTIVE').where('s.exit_reason', 'is', null);
      if (f.status === 'LEFT_SCHOOL') base = base.where('s.exit_reason', 'is not', null);
      if (f.status === 'UNPLACED')
        base = base.where('s.status', '=', 'ACTIVE').where('e.id', 'is', null);
      if (f.classId) base = base.where('c.id', '=', f.classId);
      if (f.sectionIds)
        base = base.where('sec.id', 'in', f.sectionIds.length ? f.sectionIds : ['']);

      const countRow = await base
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();

      let query = base.selectAll('s').select(['e.id as placement_id']);
      if (f.sort === 'name') query = query.orderBy('s.full_name').orderBy('s.admission_number');
      else if (f.sort === 'admission') query = query.orderBy('s.admission_number');
      else if (f.sort === 'roll')
        query = query
          .orderBy(
            sql`case when e.roll_number is null then 1 else 0 end, length(e.roll_number), e.roll_number`,
          )
          .orderBy('s.full_name');
      else
        query = query
          .orderBy(sql`case when c.id is null then 1 else 0 end`)
          .orderBy('c.display_order')
          .orderBy('sec.name')
          .orderBy(
            sql`case when e.roll_number is null then 1 else 0 end, length(e.roll_number), e.roll_number`,
          )
          .orderBy('s.full_name');
      const rows = await query.limit(f.limit).offset(f.offset).execute();

      const placementIds = rows
        .map((r) => r.placement_id)
        .filter((id): id is string => id !== null);
      const placements = new Map<string, PlacementRecord>();
      if (placementIds.length) {
        const found = await placementQuery(this.db).where('e.id', 'in', placementIds).execute();
        for (const p of found) placements.set(p.enrolment_id, toPlacement(p));
      }
      const result: StudentListRow[] = rows.map((r) => {
        const { placement_id, ...student } = r;
        return {
          student: toStudent(student as StudentsTable),
          placement: placement_id ? (placements.get(placement_id) ?? null) : null,
        };
      });
      return { rows: result, total: Number(countRow.n) };
    });
  }

  delete(id: string) {
    return guard(async () => {
      await this.db.deleteFrom('students').where('id', '=', id).execute();
    });
  }
}
