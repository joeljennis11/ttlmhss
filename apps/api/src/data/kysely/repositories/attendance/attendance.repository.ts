import {
  AttendanceStatus,
  EnrolmentStatus,
  LeaveReason,
  RecordStatus,
  Weekday,
} from '@ttlmhss/shared';
import type { Kysely } from 'kysely';
import type {
  AttendanceRecordRow,
  AttendanceRepository,
  AttendanceSessionRecord,
  NewAttendanceSession,
  PlacementOnDate,
  SessionFilter,
} from '../../../../modules/attendance/attendance.repository.js';
import type { Database } from '../../database-schema.js';
import { guard } from '../../db-errors.js';
import { controlled } from '../config/structure.repositories.js';

const num = (v: number | string | bigint | null | undefined) => Number(v ?? 0);

export class KyselyAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ---- sessions --------------------------------------------------------------------------------

  private sessions() {
    return this.db
      .selectFrom('attendance_sessions as a')
      .innerJoin('subjects as sub', 'sub.id', 'a.subject_id')
      .innerJoin('teachers as t', 't.id', 'a.teacher_id')
      .leftJoin('users as u', 'u.id', 'a.updated_by')
      .select([
        'a.id',
        'a.academic_year_id',
        'a.date',
        'a.day',
        'a.period_id',
        'a.section_id',
        'a.timetable_entry_id',
        'a.timetable_version_id',
        'a.subject_id',
        'sub.name as subject_name',
        'sub.code as subject_code',
        'a.teacher_id',
        't.full_name as teacher_name',
        't.staff_code',
        'a.revision',
        'a.created_at',
        'a.updated_at',
        'u.username as updated_by_name',
      ]);
  }

  private toSession(r: {
    id: string;
    academic_year_id: string;
    date: string;
    day: string;
    period_id: string;
    section_id: string;
    timetable_entry_id: string;
    timetable_version_id: string;
    subject_id: string;
    subject_name: string;
    subject_code: string | null;
    teacher_id: string;
    teacher_name: string;
    staff_code: string;
    revision: number;
    created_at: string;
    updated_at: string;
    updated_by_name: string | null;
  }): AttendanceSessionRecord {
    return {
      id: r.id,
      academicYearId: r.academic_year_id,
      date: r.date,
      day: controlled(Weekday, r.day, 'attendance day'),
      periodId: r.period_id,
      sectionId: r.section_id,
      timetableEntryId: r.timetable_entry_id,
      timetableVersionId: r.timetable_version_id,
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      subjectCode: r.subject_code,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      staffCode: r.staff_code,
      revision: num(r.revision),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
    };
  }

  findSession(academicYearId: string, date: string, periodId: string, sectionId: string) {
    return guard(async () => {
      const row = await this.sessions()
        .where('a.academic_year_id', '=', academicYearId)
        .where('a.date', '=', date)
        .where('a.period_id', '=', periodId)
        .where('a.section_id', '=', sectionId)
        .executeTakeFirst();
      return row ? this.toSession(row) : null;
    });
  }

  sessionsForSection(sectionId: string, from: string, to: string) {
    return guard(async () => {
      const rows = await this.sessions()
        .where('a.section_id', '=', sectionId)
        .where('a.date', '>=', from)
        .where('a.date', '<=', to)
        .orderBy('a.date')
        .execute();
      return rows.map((r) => this.toSession(r));
    });
  }

  sessionsForTeacher(teacherId: string, date: string) {
    return guard(async () => {
      const rows = await this.sessions()
        .where('a.teacher_id', '=', teacherId)
        .where('a.date', '=', date)
        .execute();
      return rows.map((r) => this.toSession(r));
    });
  }

  createSession(s: NewAttendanceSession, actorUserId: string, now: string) {
    return guard(async () => {
      await this.db
        .insertInto('attendance_sessions')
        .values({
          id: s.id,
          academic_year_id: s.academicYearId,
          date: s.date,
          day: s.day,
          period_id: s.periodId,
          section_id: s.sectionId,
          timetable_entry_id: s.timetableEntryId,
          timetable_version_id: s.timetableVersionId,
          subject_id: s.subjectId,
          teacher_id: s.teacherId,
          revision: 1,
          created_by: actorUserId,
          updated_by: actorUserId,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  advanceRevision(sessionId: string, expected: number | null, actorUserId: string, now: string) {
    return guard(async () => {
      let query = this.db
        .updateTable('attendance_sessions')
        .set((eb) => ({
          revision: eb('revision', '+', 1),
          updated_by: actorUserId,
          updated_at: now,
        }))
        .where('id', '=', sessionId);
      if (expected !== null) query = query.where('revision', '=', expected);
      const result = await query.executeTakeFirst();
      return num(result.numUpdatedRows) > 0;
    });
  }

  listSessions(f: SessionFilter, offset: number, limit: number) {
    return guard(async () => {
      let base = this.db
        .selectFrom('attendance_sessions as a')
        .where('a.academic_year_id', '=', f.academicYearId);
      if (f.from) base = base.where('a.date', '>=', f.from);
      if (f.to) base = base.where('a.date', '<=', f.to);
      if (f.sectionId) base = base.where('a.section_id', '=', f.sectionId);
      if (f.periodId) base = base.where('a.period_id', '=', f.periodId);
      if (f.subjectId) base = base.where('a.subject_id', '=', f.subjectId);
      if (f.teacherId) base = base.where('a.teacher_id', '=', f.teacherId);
      const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
      const ids = await base
        .select('a.id')
        .orderBy('a.date', 'desc')
        .orderBy('a.section_id')
        .orderBy('a.period_id')
        .offset(offset)
        .limit(limit)
        .execute();
      if (ids.length === 0) return { rows: [], total: num(total?.n) };
      const rows = await this.sessions()
        .where(
          'a.id',
          'in',
          ids.map((i) => i.id),
        )
        .execute();
      const order = new Map(ids.map((i, n) => [i.id, n]));
      return {
        rows: rows
          .map((r) => this.toSession(r))
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
        total: num(total?.n),
      };
    });
  }

  // ---- records ---------------------------------------------------------------------------------

  private records() {
    return this.db
      .selectFrom('attendance_records as r')
      .leftJoin('users as u', 'u.id', 'r.updated_by')
      .select([
        'r.id',
        'r.session_id',
        'r.academic_year_id',
        'r.date',
        'r.period_id',
        'r.enrolment_id',
        'r.student_id',
        'r.status',
        'r.leave_reason',
        'r.note',
        'r.updated_at',
        'u.username as updated_by_name',
      ]);
  }

  private toRecord(r: {
    id: string;
    session_id: string;
    academic_year_id: string;
    date: string;
    period_id: string;
    enrolment_id: string;
    student_id: string;
    status: string;
    leave_reason: string | null;
    note: string | null;
    updated_at: string;
    updated_by_name: string | null;
  }): AttendanceRecordRow {
    return {
      id: r.id,
      sessionId: r.session_id,
      academicYearId: r.academic_year_id,
      date: r.date,
      periodId: r.period_id,
      enrolmentId: r.enrolment_id,
      studentId: r.student_id,
      status: controlled(AttendanceStatus, r.status, 'attendance status'),
      leaveReason: r.leave_reason ? controlled(LeaveReason, r.leave_reason, 'leave reason') : null,
      note: r.note,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
    };
  }

  recordsForSessions(sessionIds: string[]) {
    return guard(async () => {
      if (sessionIds.length === 0) return [];
      const rows = await this.records().where('r.session_id', 'in', sessionIds).execute();
      return rows.map((r) => this.toRecord(r));
    });
  }

  recordsForStudent(studentId: string, from: string, to: string) {
    return guard(async () => {
      const rows = await this.records()
        .where('r.student_id', '=', studentId)
        .where('r.date', '>=', from)
        .where('r.date', '<=', to)
        .execute();
      return rows.map((r) => this.toRecord(r));
    });
  }

  insertRecord(
    r: Omit<AttendanceRecordRow, 'updatedAt' | 'updatedByName'>,
    actorUserId: string,
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .insertInto('attendance_records')
        .values({
          id: r.id,
          session_id: r.sessionId,
          academic_year_id: r.academicYearId,
          date: r.date,
          period_id: r.periodId,
          enrolment_id: r.enrolmentId,
          student_id: r.studentId,
          status: r.status,
          leave_reason: r.leaveReason,
          note: r.note,
          created_by: actorUserId,
          updated_by: actorUserId,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
  }

  updateRecord(
    id: string,
    change: { status: AttendanceStatus; leaveReason: LeaveReason | null; note: string | null },
    actorUserId: string,
    now: string,
  ) {
    return guard(async () => {
      await this.db
        .updateTable('attendance_records')
        .set({
          status: change.status,
          leave_reason: change.leaveReason,
          note: change.note,
          updated_by: actorUserId,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();
    });
  }

  // ---- placements ------------------------------------------------------------------------------

  private placements(academicYearId: string, from: string, to: string) {
    return this.db
      .selectFrom('enrolments as e')
      .innerJoin('students as s', 's.id', 'e.student_id')
      .select([
        'e.id as enrolment_id',
        'e.student_id',
        'e.academic_year_id',
        'e.section_id',
        'e.roll_number',
        'e.status as enrolment_status',
        'e.started_on',
        'e.ended_on',
        's.admission_number',
        's.full_name',
        's.status as student_status',
      ])
      .where('e.academic_year_id', '=', academicYearId)
      .where('e.started_on', '<=', to)
      .where((eb) => eb.or([eb('e.ended_on', 'is', null), eb('e.ended_on', '>=', from)]));
  }

  private toPlacement(r: {
    enrolment_id: string;
    student_id: string;
    academic_year_id: string;
    section_id: string;
    roll_number: string | null;
    enrolment_status: string;
    started_on: string;
    ended_on: string | null;
    admission_number: string;
    full_name: string;
    student_status: string;
  }): PlacementOnDate {
    return {
      enrolmentId: r.enrolment_id,
      studentId: r.student_id,
      academicYearId: r.academic_year_id,
      sectionId: r.section_id,
      rollNumber: r.roll_number,
      enrolmentStatus: controlled(EnrolmentStatus, r.enrolment_status, 'enrolment status'),
      startedOn: r.started_on,
      endedOn: r.ended_on,
      admissionNumber: r.admission_number,
      fullName: r.full_name,
      studentStatus: controlled(RecordStatus, r.student_status, 'student status'),
    };
  }

  placementsInSection(academicYearId: string, sectionId: string, from: string, to: string) {
    return guard(async () => {
      const rows = await this.placements(academicYearId, from, to)
        .where('e.section_id', '=', sectionId)
        .execute();
      return rows.map((r) => this.toPlacement(r));
    });
  }

  placementsOfStudents(studentIds: string[], academicYearId: string, from: string, to: string) {
    return guard(async () => {
      if (studentIds.length === 0) return [];
      const rows = await this.placements(academicYearId, from, to)
        .where('e.student_id', 'in', studentIds)
        .execute();
      return rows.map((r) => this.toPlacement(r));
    });
  }

  countForStudent(studentId: string) {
    return guard(async () => {
      const row = await this.db
        .selectFrom('attendance_records')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('student_id', '=', studentId)
        .executeTakeFirst();
      return num(row?.n);
    });
  }
}
