import {
  componentsOf,
  fromHundredths,
  orderGradeBands,
  scoreSubject,
  totalMaxOf,
  type MarkSheetRowView,
  type MarkStructure,
  type MarkStructureView,
  type Permission,
  type RawMarks,
} from '@ttlmhss/shared';
import { AuditRecorder, type AuditEvent } from '../../core/audit/audit-recorder.js';
import type { Principal } from '../../core/auth/access.js';
import type { AuthorizationService } from '../../core/auth/authorization.service.js';
import { toTimestamp, type Clock } from '../../core/utils/clock.js';
import type { DataStore, Repositories } from '../../data/data-store.js';
import { rosterOn, sectionPlacements, byRoll } from '../attendance/attendance-service.js';
import type {
  AcademicYearRecord,
  ExamRecord,
  ExamSubjectRecord,
  SubjectRecord,
} from '../config/config.repository.js';
import { sectionRef } from '../timetable/timetable-service.js';
import type { MarkEntryRecord, MarkSheetRecord } from './marks.repository.js';

export interface RequestContext {
  principal: Principal | null;
  requestId: string | null;
}

export interface MarksServiceDeps {
  dataStore: DataStore;
  clock: Clock;
  authorization: AuthorizationService;
}

export interface WriteScope {
  repos: Repositories;
  now: string;
  actor: Principal;
  audit(event: AuditEvent): Promise<void>;
}

/** The same refusal whether a sheet does not exist or is outside the caller's scope. */
export const NO_SHEET_ACCESS = 'You do not have access to this mark sheet.';

const SCHOOL_TIME_ZONE = 'Asia/Kolkata';

export function schoolToday(clock: Clock): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(clock.now());
}

/** Base of the marks services: authorize first; a change and its audit in ONE transaction. */
export abstract class MarksServiceBase {
  constructor(protected readonly deps: MarksServiceDeps) {}

  protected get repos(): Repositories {
    return this.deps.dataStore.repositories;
  }

  protected authorize(ctx: RequestContext, permission: Permission): Principal {
    return this.deps.authorization.authorize(ctx.principal, permission);
  }

  protected isAdmin(principal: Principal): boolean {
    return this.deps.authorization.isAdmin(principal);
  }

  protected today(): string {
    return schoolToday(this.deps.clock);
  }

  protected write<T>(
    ctx: RequestContext,
    permission: Permission,
    work: (scope: WriteScope) => Promise<T>,
  ): Promise<T> {
    const actor = this.authorize(ctx, permission);
    return this.deps.dataStore.transaction(async (repos) => {
      const recorder = new AuditRecorder(repos.auditLogs, this.deps.clock);
      return work({
        repos,
        actor,
        now: toTimestamp(this.deps.clock.now()),
        audit: async (event) => {
          await recorder.record(event, { actorUserId: actor.userId, requestId: ctx.requestId });
        },
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Where a sheet belongs
// ---------------------------------------------------------------------------

export interface SheetContext {
  year: AcademicYearRecord;
  exam: ExamRecord;
  examSubject: ExamSubjectRecord;
  subject: SubjectRecord;
  section: Awaited<ReturnType<typeof sectionRef>>;
  sheet: MarkSheetRecord | null;
  /** How the subject is marked under TODAY's configuration. */
  structure: MarkStructure;
}

/** The grade scale that applies: the subject's own, else the exam's (Phase 4, D-37). */
export async function structureOf(
  repos: Repositories,
  exam: ExamRecord,
  examSubject: ExamSubjectRecord,
): Promise<MarkStructure> {
  const schemeId = examSubject.gradeSchemeId ?? exam.gradeSchemeId;
  const scheme = schemeId ? await repos.gradeSchemes.find(schemeId) : null;
  return {
    theoryMax: examSubject.theoryMax,
    internalMax: examSubject.internalMax,
    practicalMax: examSubject.practicalMax,
    passMarks: examSubject.passMarks,
    normalizedMax: examSubject.normalizedMax,
    includeInResult: examSubject.includeInResult,
    gradeScale: scheme
      ? {
          id: scheme.id,
          name: scheme.name,
          bands: scheme.bands.map((b) => ({ label: b.label, minPercent: b.minBp / 100 })),
        }
      : null,
  };
}

export function structureView(s: MarkStructure): MarkStructureView {
  return {
    components: componentsOf(s),
    totalMax: totalMaxOf(s),
    passMarks: s.passMarks,
    normalizedMax: s.normalizedMax,
    includeInResult: s.includeInResult,
    gradeScale: s.gradeScale
      ? {
          name: s.gradeScale.name,
          bands: orderGradeBands(s.gradeScale.bands.map((b) => ({ ...b, remark: null }))).map(
            ({ label, minPercent, maxPercent }) => ({ label, minPercent, maxPercent }),
          ),
        }
      : null,
  };
}

/**
 * Load a sheet's context, or null when the exam subject does not exist or the section is not a
 * section of its class (the caller decides between 404 and a scope refusal).
 */
export async function loadSheetContext(
  repos: Repositories,
  examSubjectId: string,
  sectionId: string,
): Promise<SheetContext | null> {
  const examSubject = await repos.exams.findSubject(examSubjectId);
  if (!examSubject) return null;
  const sectionRecord = await repos.classes.findSection(sectionId);
  if (!sectionRecord || sectionRecord.classId !== examSubject.classId) return null;
  const exam = (await repos.exams.find(examSubject.examId))!;
  const [year, subject, section, sheet] = await Promise.all([
    repos.academicYears.find(exam.academicYearId),
    repos.subjects.find(examSubject.subjectId),
    sectionRef(repos, sectionId),
    repos.marks.findSheet(examSubjectId, sectionId),
  ]);
  return {
    year: year!,
    exam,
    examSubject,
    subject: subject!,
    section,
    sheet,
    structure: await structureOf(repos, exam, examSubject),
  };
}

/** Audit snapshot of where marks belong (names included so history stays readable). */
export function describeSheet(c: SheetContext) {
  return {
    academicYearId: c.year.id,
    academicYear: c.year.label,
    examId: c.exam.id,
    exam: c.exam.name,
    examSubjectId: c.examSubject.id,
    subjectId: c.subject.id,
    subject: c.subject.name,
    classId: c.section.classId,
    sectionId: c.section.sectionId,
    classSection: c.section.label,
  };
}

// ---------------------------------------------------------------------------
// Roster (BR-MK-07, D-76)
// ---------------------------------------------------------------------------

/**
 * The date whose placements make up an exam's roster: the exam's end date, else its start date,
 * else today — kept inside the academic year.
 */
export function rosterDate(exam: ExamRecord, year: AcademicYearRecord, today: string): string {
  const date = exam.endDate ?? exam.startDate ?? today;
  if (date < year.startDate) return year.startDate;
  if (date > year.endDate) return year.endDate;
  return date;
}

export interface SheetStudent {
  studentId: string;
  enrolmentId: string;
  rollNumber: string | null;
  admissionNumber: string;
  fullName: string;
  /** False: holds marks on this sheet but is no longer placed in the section on the roster date. */
  onRoll: boolean;
}

/**
 * Students on a sheet: everyone placed in the section on the roster date, plus anyone who already
 * has marks on it (their placement at the time is kept — marks never move with the student).
 * Sorted by roll number, then name.
 */
export async function sheetStudents(
  repos: Repositories,
  c: Pick<SheetContext, 'year' | 'exam' | 'section'>,
  /** Rows already stored on the sheet (marks, or Phase 9 behaviour assessments). */
  entries: readonly Pick<MarkEntryRecord, 'studentId' | 'enrolmentId'>[],
  today: string,
): Promise<SheetStudent[]> {
  const date = rosterDate(c.exam, c.year, today);
  const placements = await sectionPlacements(repos, c.year.id, c.section.sectionId, date, date);
  const roster: SheetStudent[] = rosterOn(placements, c.section.sectionId, date).map((s) => ({
    ...s,
    onRoll: true,
  }));
  const onRoll = new Set(roster.map((s) => s.studentId));
  for (const e of entries) {
    if (onRoll.has(e.studentId)) continue;
    const [student, placement] = await Promise.all([
      repos.students.find(e.studentId),
      repos.enrolments.find(e.enrolmentId),
    ]);
    roster.push({
      studentId: e.studentId,
      enrolmentId: e.enrolmentId,
      rollNumber: placement?.rollNumber ?? null,
      admissionNumber: student?.admissionNumber ?? '',
      fullName: student?.fullName ?? '',
      onRoll: false,
    });
  }
  return roster.sort(byRoll);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const rawOf = (e: MarkEntryRecord | undefined): RawMarks => ({
  theory: e?.theoryCm ?? null,
  internal: e?.internalCm ?? null,
  practical: e?.practicalCm ?? null,
});

const shown = (cm: number | null) => (cm === null ? null : fromHundredths(cm));

/**
 * A row as shown to staff. Submitted sheets show the values stored at submission; drafts show a
 * live preview computed with today's configuration (nothing is visible to students).
 */
export function sheetRow(
  student: SheetStudent,
  entry: MarkEntryRecord | undefined,
  structure: MarkStructure,
  submitted: boolean,
): MarkSheetRowView {
  const raw = rawOf(entry);
  const live = scoreSubject(structure, raw);
  const stored =
    submitted && entry && entry.totalCm !== null
      ? {
          total: shown(entry.totalCm),
          normalized: shown(entry.normalizedCm),
          percent: entry.percentBp === null ? null : entry.percentBp / 100,
          grade: entry.grade,
          result:
            entry.passed === null ? null : entry.passed ? ('PASS' as const) : ('FAIL' as const),
        }
      : null;
  return {
    ...student,
    marks: {
      theory: shown(raw.theory),
      internal: shown(raw.internal),
      practical: shown(raw.practical),
    },
    complete: live !== null,
    ...(stored ?? {
      total: live ? shown(live.totalCm) : null,
      normalized: live ? shown(live.normalizedCm) : null,
      percent: live ? live.percentBp / 100 : null,
      grade: live?.grade ?? null,
      result: live ? (live.passed ? 'PASS' : 'FAIL') : null,
    }),
    updatedAt: entry?.updatedAt ?? null,
    updatedBy: entry?.updatedByName ?? null,
  };
}
