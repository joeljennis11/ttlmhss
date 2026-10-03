import type { TimetableIssue, Weekday } from '@ttlmhss/shared';
import { fieldConflict } from '../../core/errors/app-errors.js';
import type { Repositories } from '../../data/data-store.js';
import type { PeriodRecord, SubjectRecord } from '../config/config.repository.js';
import type { TeacherRecord } from '../people/people.repository.js';
import type { TimetableEntryRecord } from './timetable.repository.js';
import { DAY_NAMES, slotName, type WeekFrame } from './timetable-service.js';

/**
 * Timetable validation (BR-TT-02, 04, 05, 06, 11). Every rule lives here and runs on the server for
 * each change and again for the whole draft on publish. Messages name the day, period, class and
 * teacher so the person fixing it knows exactly where to look.
 *
 * `field` is the request path the message is attached to (e.g. `operations.2.teacherId`).
 */

/** A lesson slot: a working day + an active teaching period of the year (not a break). */
export function checkSlot(
  frame: WeekFrame,
  day: Weekday,
  periodId: string,
  field: (name: string) => string,
): PeriodRecord {
  const { year } = frame;
  if (frame.workingDays.length === 0) {
    throw fieldConflict(
      field('day'),
      `The working days of ${year.label} are not set yet. Set them in School setup → Academic years first.`,
    );
  }
  if (!frame.workingDays.includes(day)) {
    throw fieldConflict(field('day'), `${DAY_NAMES[day]} is not a working day in ${year.label}.`);
  }
  const slot = frame.slotById.get(periodId);
  if (!slot) {
    throw fieldConflict(
      field('periodId'),
      `That period is not part of the ${year.label} school day.`,
    );
  }
  if (slot.kind === 'BREAK') {
    throw fieldConflict(
      field('periodId'),
      `${slot.label} is a break. Lessons cannot be placed in a break.`,
    );
  }
  if (slot.status !== 'ACTIVE') {
    throw fieldConflict(field('periodId'), `${slot.label} is inactive. Choose an active period.`);
  }
  return slot;
}

/** Subject active, teacher active, and Teacher → Subject assigned (BR-TT-02). */
export async function checkTeaching(
  repos: Repositories,
  subjectId: string,
  teacherId: string,
  field: (name: string) => string,
): Promise<{ subject: SubjectRecord; teacher: TeacherRecord }> {
  const subject = await repos.subjects.find(subjectId);
  if (!subject) throw fieldConflict(field('subjectId'), 'That subject was not found.');
  if (subject.status !== 'ACTIVE') {
    throw fieldConflict(
      field('subjectId'),
      `${subject.name} is inactive and cannot be timetabled.`,
    );
  }
  const teacher = await repos.teachers.find(teacherId);
  if (!teacher) throw fieldConflict(field('teacherId'), 'That teacher was not found.');
  if (teacher.status !== 'ACTIVE') {
    throw fieldConflict(
      field('teacherId'),
      `${teacher.fullName} is inactive and cannot be timetabled.`,
    );
  }
  if (!(await repos.teacherSubjects.exists(teacherId, subjectId))) {
    throw fieldConflict(
      field('teacherId'),
      `${teacher.fullName} is not assigned ${subject.name}. Add ${subject.name} to the teacher's subjects first.`,
    );
  }
  return { subject, teacher };
}

/**
 * Conflicts A and B: the class/section and the teacher must both be free in that slot of the draft.
 * `ignoreEntryId` is the entry being moved/edited (it may keep its own slot).
 */
export async function checkFree(
  repos: Repositories,
  frame: WeekFrame,
  versionId: string,
  slot: { sectionId: string; sectionLabel: string; teacherId: string; teacherName: string },
  day: Weekday,
  periodId: string,
  ignoreEntryId: string | null,
  field: (name: string) => string,
): Promise<void> {
  const where = slotName(frame, day, periodId);
  const sectionTaken = await repos.timetable.sectionSlot(versionId, slot.sectionId, day, periodId);
  if (sectionTaken && sectionTaken.id !== ignoreEntryId) {
    throw fieldConflict(
      field('periodId'),
      `${slot.sectionLabel} already has ${sectionTaken.subjectName} (${sectionTaken.teacherName}) on ${where}.`,
    );
  }
  const teacherBusy = await repos.timetable.teacherSlot(versionId, slot.teacherId, day, periodId);
  if (teacherBusy && teacherBusy.id !== ignoreEntryId) {
    throw fieldConflict(
      field('teacherId'),
      `${slot.teacherName} already teaches ${teacherBusy.className} ${teacherBusy.sectionName} (${teacherBusy.subjectName}) on ${where}.`,
    );
  }
}

/**
 * Whole-draft check before publishing. Entries were valid when added, but the configuration may
 * have changed since (a period made inactive, a working day removed, a teacher deactivated, a
 * subject unassigned …). Returns every problem; an empty list means the draft can be published.
 * Collisions cannot exist: the database's unique indexes refuse them.
 */
export async function draftIssues(
  repos: Repositories,
  frame: WeekFrame,
  entries: readonly TimetableEntryRecord[],
): Promise<TimetableIssue[]> {
  const teacherIds = [...new Set(entries.map((e) => e.teacherId))];
  const assigned = await repos.teacherSubjects.forTeachers(teacherIds);
  const issues: TimetableIssue[] = [];
  for (const e of entries) {
    const where = `${e.className} ${e.sectionName}, ${slotName(frame, e.day, e.periodId)}`;
    const add = (problem: string) =>
      issues.push({ entryId: e.id, sectionId: e.sectionId, message: `${where}: ${problem}` });
    const slot = frame.slotById.get(e.periodId);
    if (!frame.workingDays.includes(e.day)) {
      add(`${DAY_NAMES[e.day]} is no longer a working day.`);
    }
    if (!slot || slot.academicYearId !== frame.year.id) add('the period is not part of this year.');
    else if (slot.kind === 'BREAK') add(`${slot.label} is a break.`);
    else if (slot.status !== 'ACTIVE') add(`${slot.label} is inactive.`);
    if (e.classStatus !== 'ACTIVE' || e.sectionStatus !== 'ACTIVE')
      add('the class or section is inactive.');
    if (e.subjectStatus !== 'ACTIVE') add(`${e.subjectName} is inactive.`);
    if (e.teacherStatus !== 'ACTIVE') add(`${e.teacherName} is inactive.`);
    else if (!(assigned.get(e.teacherId) ?? []).some((s) => s.id === e.subjectId)) {
      add(`${e.teacherName} is no longer assigned ${e.subjectName}.`);
    }
  }
  return issues;
}
