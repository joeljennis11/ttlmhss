import { describe, expect, it } from 'vitest';
import {
  AcademicYearCreateSchema,
  ExamSubjectInputSchema,
  ExamSubjectsUpdateSchema,
  GradeSchemeInputSchema,
  PERMISSIONS,
  PERMISSION_INFO,
  PeriodCreateSchema,
  SchoolSettingsUpdateSchema,
  attendanceLockDate,
  grantableTo,
  gradeFor,
  isAttendanceLocked,
  normalizeMarks,
  orderGradeBands,
  percentSchema,
} from '../src/index.js';

describe('attendance locking rule (BR-ATT-11)', () => {
  const policy = { mode: 'MONTHLY_CUTOFF' as const, cutoffDay: 7 };

  it('September is editable through 7 October and locked from 8 October', () => {
    expect(attendanceLockDate(policy, 2026, 9)).toBe('2026-10-08');
    expect(isAttendanceLocked(policy, '2026-09-15', '2026-10-07')).toBe(false);
    expect(isAttendanceLocked(policy, '2026-09-15', '2026-10-08')).toBe(true);
    expect(isAttendanceLocked(policy, '2026-10-01', '2026-10-08')).toBe(false);
  });

  it('December rolls into January of the next year', () => {
    expect(attendanceLockDate({ mode: 'MONTHLY_CUTOFF', cutoffDay: 28 }, 2026, 12)).toBe(
      '2027-01-29',
    );
  });

  it('never locks when the policy is off', () => {
    expect(attendanceLockDate({ mode: 'NO_LOCK', cutoffDay: 7 }, 2026, 9)).toBeNull();
    expect(isAttendanceLocked({ mode: 'NO_LOCK', cutoffDay: 7 }, '2020-01-01', '2030-01-01')).toBe(
      false,
    );
  });
});

describe('grade scales', () => {
  const bands = [
    { label: 'A', minPercent: 80, remark: null },
    { label: 'A+', minPercent: 90, remark: null },
    { label: 'B', minPercent: 0, remark: null },
  ];

  it('derives non-overlapping ranges with no gaps', () => {
    expect(orderGradeBands(bands).map((b) => [b.label, b.minPercent, b.maxPercent])).toEqual([
      ['A+', 90, 100],
      ['A', 80, 90],
      ['B', 0, 80],
    ]);
  });

  it('every percentage gets exactly one grade, boundaries inclusive at the bottom', () => {
    expect(gradeFor(bands, 100)).toBe('A+');
    expect(gradeFor(bands, 90)).toBe('A+');
    expect(gradeFor(bands, 89.99)).toBe('A');
    expect(gradeFor(bands, 0)).toBe('B');
  });

  it('rejects duplicate names, duplicate starts and scales without a 0% grade', () => {
    const bad = GradeSchemeInputSchema.safeParse({
      name: 'Test',
      bands: [
        { label: 'A', minPercent: 50 },
        { label: 'a', minPercent: 50 },
      ],
    });
    const messages = bad.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('Each grade must have a different name');
    expect(messages).toContain('Two grades cannot start at the same percentage');
    expect(messages).toContain('The lowest grade must start at 0% so every mark gets a grade');
  });
});

describe('percent and marks validation', () => {
  it('accepts up to two decimals', () => {
    expect(percentSchema('W').safeParse(33.33).success).toBe(true);
    expect(percentSchema('W').safeParse(33.333).success).toBe(false);
    expect(percentSchema('W').safeParse(100.01).success).toBe(false);
  });

  it('exam subject: pass marks cannot exceed the component total', () => {
    const ok = ExamSubjectInputSchema.safeParse({
      subjectId: 's',
      theoryMax: 70,
      internalMax: 10,
      practicalMax: 20,
      passMarks: 35,
    });
    expect(ok.success).toBe(true);
    const bad = ExamSubjectInputSchema.safeParse({
      subjectId: 's',
      theoryMax: 40,
      internalMax: 10,
      passMarks: 60,
    });
    expect(bad.error?.issues[0]?.message).toBe('Pass marks cannot exceed the total of 50');
    expect(
      ExamSubjectInputSchema.safeParse({ subjectId: 's', theoryMax: 0, passMarks: 0 }).success,
    ).toBe(false);
    expect(
      ExamSubjectInputSchema.safeParse({ subjectId: 's', theoryMax: 50.5, passMarks: 20 }).success,
    ).toBe(false);
  });

  it('exam subjects cannot repeat a subject', () => {
    const r = ExamSubjectsUpdateSchema.safeParse({
      subjects: [
        { subjectId: 'x', theoryMax: 100, passMarks: 35 },
        { subjectId: 'x', theoryMax: 100, passMarks: 35 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('normalization scales the obtained total and keeps it unchanged when not configured', () => {
    expect(normalizeMarks(42, 50, 100)).toBe(84);
    expect(normalizeMarks(42, 50, null)).toBe(42);
  });
});

describe('dates, times and school settings', () => {
  it('academic year must end after it starts', () => {
    expect(
      AcademicYearCreateSchema.safeParse({
        label: '2026-27',
        startDate: '2026-06-01',
        endDate: '2027-04-30',
      }).success,
    ).toBe(true);
    expect(
      AcademicYearCreateSchema.safeParse({
        label: '2026-27',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
      }).success,
    ).toBe(false);
  });

  it('periods need a number, breaks must not have one, and times must be in order', () => {
    expect(
      PeriodCreateSchema.safeParse({
        kind: 'LESSON',
        periodNumber: 1,
        label: 'P1',
        startTime: '09:00',
        endTime: '09:45',
      }).success,
    ).toBe(true);
    expect(
      PeriodCreateSchema.safeParse({
        kind: 'LESSON',
        label: 'P1',
        startTime: '09:00',
        endTime: '09:45',
      }).success,
    ).toBe(false);
    expect(
      PeriodCreateSchema.safeParse({
        kind: 'BREAK',
        periodNumber: 2,
        label: 'Lunch',
        startTime: '12:00',
        endTime: '12:40',
      }).success,
    ).toBe(false);
    expect(
      PeriodCreateSchema.safeParse({
        kind: 'BREAK',
        label: 'Lunch',
        startTime: '12:40',
        endTime: '12:00',
      }).success,
    ).toBe(false);
  });

  it('school settings: blanks become null, contact formats are checked, logo must be a /brand/ file', () => {
    const base = { fullName: 'School', shortName: 'SCH' };
    expect(SchoolSettingsUpdateSchema.parse({ ...base, email: '', website: '' })).toMatchObject({
      email: null,
      website: null,
    });
    expect(SchoolSettingsUpdateSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(
      false,
    );
    expect(SchoolSettingsUpdateSchema.safeParse({ ...base, website: 'example.org' }).success).toBe(
      false,
    );
    expect(SchoolSettingsUpdateSchema.safeParse({ ...base, phone: 'call me' }).success).toBe(false);
    expect(
      SchoolSettingsUpdateSchema.safeParse({ ...base, logoUrl: 'https://evil.example/x.png' })
        .success,
    ).toBe(false);
    expect(
      SchoolSettingsUpdateSchema.safeParse({ ...base, logoUrl: '/brand/ttlmhss-logo.webp' })
        .success,
    ).toBe(true);
  });
});

describe('permission ceilings', () => {
  it('admin-only permissions can never be granted to another role', () => {
    for (const key of [
      'users.create',
      'config.manage',
      'permissions.manage',
      'attendance.override',
      'exams.manage',
    ] as const) {
      expect(PERMISSION_INFO[key].grantableTo).toEqual([]);
    }
  });

  it('students can only ever hold view permissions plus sending requests', () => {
    for (const permission of grantableTo('STUDENT')) {
      expect(permission.endsWith('.view') || permission === 'requests.create').toBe(true);
    }
  });

  it('subject teachers can never manage achievements (BR-ACH-01)', () => {
    expect(grantableTo('TEACHER')).not.toContain('achievements.manage');
  });

  it('every permission has metadata', () => {
    expect(Object.keys(PERMISSION_INFO).sort()).toEqual([...PERMISSIONS].sort());
  });
});
