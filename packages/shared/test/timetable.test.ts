import { describe, expect, it } from 'vitest';
import { TimetableChangesSchema, TimetableOperationSchema, weekdayOf } from '../src/index.js';

let n = 0;
/** Synthetic, valid v4 UUIDs. */
const randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('timetable contract', () => {
  it('derives the weekday of a calendar date without time zones', () => {
    expect(weekdayOf('2026-06-01')).toBe('MON');
    expect(weekdayOf('2026-06-06')).toBe('SAT');
    expect(weekdayOf('2027-02-28')).toBe('SUN');
  });

  it('accepts the four kinds of change and rejects anything else', () => {
    const id = randomUUID();
    const ok = [
      { op: 'create', id, day: 'MON', periodId: id, sectionId: id, subjectId: id, teacherId: id },
      { op: 'update', entryId: id, subjectId: id, teacherId: id },
      { op: 'move', entryId: id, day: 'FRI', periodId: id },
      { op: 'remove', entryId: id },
    ];
    for (const op of ok) expect(TimetableOperationSchema.safeParse(op).success).toBe(true);
    expect(TimetableOperationSchema.safeParse({ op: 'swap', entryId: id }).success).toBe(false);
    expect(TimetableOperationSchema.safeParse({ ...ok[2], day: 'FUNDAY' }).success).toBe(false);
    expect(TimetableOperationSchema.safeParse({ ...ok[0], teacherId: 'not-an-id' }).success).toBe(
      false,
    );
  });

  it('a batch needs at least one change and defaults to saving (not a dry run)', () => {
    const sectionId = randomUUID();
    expect(TimetableChangesSchema.safeParse({ sectionId, operations: [] }).success).toBe(false);
    const parsed = TimetableChangesSchema.parse({
      sectionId,
      operations: [{ op: 'remove', entryId: sectionId }],
    });
    expect(parsed.dryRun).toBe(false);
  });
});
