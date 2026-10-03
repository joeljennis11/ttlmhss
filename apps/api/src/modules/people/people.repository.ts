import type { EnrolmentStatus, ExitReason, Gender, RecordStatus } from '@ttlmhss/shared';

/*
 * Phase 5 repository interfaces (students, enrolments, teachers, teacher subjects, class teachers).
 * Services depend on these only; implementations live in src/data/kysely/repositories/people/.
 */

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export interface StudentDetailsRecord {
  fullName: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  fatherName: string | null;
  motherName: string | null;
  guardianName: string | null;
  guardianRelation: string | null;
  guardianPhone: string | null;
  phone: string | null;
  email: string | null;
  emergencyPhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface StudentRecord extends StudentDetailsRecord {
  id: string;
  userId: string;
  admissionNumber: string;
  admissionDate: string | null;
  photoPath: string | null;
  status: RecordStatus;
  exitReason: ExitReason | null;
  exitDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewStudent extends StudentDetailsRecord {
  id: string;
  userId: string;
  admissionNumber: string;
  admissionDate: string;
}

/** A placement with the names needed to show it. */
export interface PlacementRecord {
  enrolmentId: string;
  studentId: string;
  academicYearId: string;
  academicYearLabel: string;
  academicYearStart: string;
  classId: string;
  className: string;
  classOrder: number;
  sectionId: string;
  sectionName: string;
  rollNumber: string | null;
  status: EnrolmentStatus;
  startedOn: string;
  endedOn: string | null;
}

export interface StudentListFilter {
  q: string | null;
  /** Year whose placement is shown and filtered on (null: no years exist). */
  academicYearId: string | null;
  classId: string | null;
  /** Restrict to these sections (filter or scope). Null = no restriction. */
  sectionIds: string[] | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LEFT_SCHOOL' | 'UNPLACED' | 'ALL';
  sort: 'name' | 'admission' | 'roll' | 'class';
  offset: number;
  limit: number;
}

export interface StudentListRow {
  student: StudentRecord;
  placement: PlacementRecord | null;
}

export interface StudentRepository {
  find(id: string): Promise<StudentRecord | null>;
  findByUserId(userId: string): Promise<StudentRecord | null>;
  findByAdmissionNumber(admissionNumber: string): Promise<StudentRecord | null>;
  create(student: NewStudent, now: string): Promise<void>;
  updateDetails(id: string, details: StudentDetailsRecord, now: string): Promise<void>;
  setStatus(
    id: string,
    status: RecordStatus,
    exit: { reason: ExitReason; date: string } | null,
    now: string,
  ): Promise<void>;
  list(filter: StudentListFilter): Promise<{ rows: StudentListRow[]; total: number }>;
  delete(id: string): Promise<void>;
}

export interface NewEnrolment {
  id: string;
  studentId: string;
  academicYearId: string;
  sectionId: string;
  rollNumber: string | null;
  startedOn: string;
  note: string | null;
  createdBy: string | null;
}

export interface EnrolmentRepository {
  find(id: string): Promise<PlacementRecord | null>;
  /** Every placement of a student, newest year first. */
  listForStudent(studentId: string): Promise<PlacementRecord[]>;
  findActive(studentId: string, academicYearId: string): Promise<PlacementRecord | null>;
  /** Any placement (any status) of the student in the year. */
  listForStudentInYear(studentId: string, academicYearId: string): Promise<PlacementRecord[]>;
  /** ACTIVE placements in a section, ordered by roll number then name. */
  listActiveInSection(
    academicYearId: string,
    sectionId: string,
  ): Promise<(PlacementRecord & { fullName: string; admissionNumber: string })[]>;
  /** The newest placement of each given student in the year (any status). */
  placementsInYear(
    studentIds: string[],
    academicYearId: string,
  ): Promise<Map<string, PlacementRecord>>;
  /** Is the roll number already used by another ACTIVE placement in the section? */
  rollNumberTaken(
    academicYearId: string,
    sectionId: string,
    rollNumber: string,
    exceptEnrolmentId?: string,
  ): Promise<boolean>;
  create(enrolment: NewEnrolment, now: string): Promise<void>;
  close(
    id: string,
    change: {
      status: Exclude<EnrolmentStatus, 'ACTIVE'>;
      endedOn: string;
      closedBy: string | null;
      note: string | null;
    },
    now: string,
  ): Promise<void>;
  countForStudent(studentId: string): Promise<number>;
  deleteForStudent(studentId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

export interface TeacherDetailsRecord {
  fullName: string;
  gender: Gender | null;
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  designation: string | null;
  qualification: string | null;
  joiningDate: string | null;
}

export interface TeacherRecord extends TeacherDetailsRecord {
  id: string;
  userId: string;
  staffCode: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherListFilter {
  q: string | null;
  subjectId: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ALL';
  designation: string | null;
  offset: number;
  limit: number;
}

export interface TeacherRepository {
  find(id: string): Promise<TeacherRecord | null>;
  findByStaffCode(staffCode: string): Promise<TeacherRecord | null>;
  create(
    teacher: TeacherDetailsRecord & { id: string; userId: string; staffCode: string },
    now: string,
  ): Promise<void>;
  updateDetails(id: string, details: TeacherDetailsRecord, now: string): Promise<void>;
  setStatus(id: string, status: RecordStatus, now: string): Promise<void>;
  list(filter: TeacherListFilter): Promise<{ rows: TeacherRecord[]; total: number }>;
  /** Distinct designations in use (for the list filter). */
  designations(): Promise<string[]>;
  delete(id: string): Promise<void>;
}

export interface SubjectRef {
  id: string;
  name: string;
  code: string | null;
  status: RecordStatus;
}

export interface TeacherSubjectRepository {
  /** Subjects of each teacher, in subject display order. */
  forTeachers(teacherIds: string[]): Promise<Map<string, SubjectRef[]>>;
  exists(teacherId: string, subjectId: string): Promise<boolean>;
  add(teacherId: string, subjectId: string, now: string): Promise<void>;
  remove(teacherId: string, subjectId: string): Promise<void>;
  deleteForTeacher(teacherId: string): Promise<void>;
}

export interface ClassTeacherRecord {
  id: string;
  teacherId: string;
  teacherName: string;
  staffCode: string;
  academicYearId: string;
  academicYearLabel: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  status: RecordStatus;
  assignedOn: string;
  endedOn: string | null;
}

export interface ClassTeacherRepository {
  find(id: string): Promise<ClassTeacherRecord | null>;
  forTeacher(teacherId: string): Promise<ClassTeacherRecord[]>;
  /** ACTIVE assignments in a year (optionally only for some teachers). */
  activeInYear(academicYearId: string, teacherIds?: string[]): Promise<ClassTeacherRecord[]>;
  findActiveForSection(
    academicYearId: string,
    sectionId: string,
  ): Promise<ClassTeacherRecord | null>;
  create(
    assignment: {
      id: string;
      teacherId: string;
      academicYearId: string;
      sectionId: string;
      assignedOn: string;
    },
    now: string,
  ): Promise<void>;
  end(id: string, endedOn: string, now: string): Promise<void>;
  countForTeacher(teacherId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Linked accounts (read side of users/credentials needed by management screens)
// ---------------------------------------------------------------------------

export interface LinkedAccount {
  userId: string;
  username: string;
  status: RecordStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface PersonAccountRepository {
  find(userId: string): Promise<LinkedAccount | null>;
  /** True when the account was never used: no sign-in and no audit entries as the actor. */
  isUnused(userId: string): Promise<boolean>;
  /** Remove an unused account entirely (sessions, credential, user). */
  delete(userId: string): Promise<void>;
}
