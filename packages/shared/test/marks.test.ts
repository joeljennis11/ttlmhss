import { describe, expect, it } from 'vitest';
import {
  MarkSheetSaveSchema,
  MarkSheetUnlockSchema,
  competitionRanks,
  componentsOf,
  gradeForBp,
  halfUpDiv,
  isComplete,
  scoreSubject,
  summarizeExam,
  toHundredths,
  type MarkStructure,
} from '../src/index.js';

/* Phase 8B — mark arithmetic in isolation. Every value below is synthetic. */
const SCALE = {
  id: 'g',
  name: 'TEST scale',
  bands: [
    { label: 'A+', minPercent: 90 },
    { label: 'A', minPercent: 80 },
    { label: 'B', minPercent: 60 },
    { label: 'C', minPercent: 35 },
    { label: 'D', minPercent: 0 },
  ],
};
const structure = (over: Partial<MarkStructure> = {}): MarkStructure => ({
  theoryMax: 100,
  internalMax: null,
  practicalMax: null,
  passMarks: 35,
  normalizedMax: null,
  includeInResult: true,
  gradeScale: SCALE,
  ...over,
});
const raw = (
  theory: number | null,
  internal: number | null = null,
  practical: number | null = null,
) => ({
  theory: theory === null ? null : toHundredths(theory),
  internal: internal === null ? null : toHundredths(internal),
  practical: practical === null ? null : toHundredths(practical),
});

describe('exact arithmetic', () => {
  it('rounds half up to two decimals', () => {
    expect(halfUpDiv(1, 2)).toBe(1); // 0.5 → 1
    expect(halfUpDiv(1, 3)).toBe(0);
    expect(halfUpDiv(2, 3)).toBe(1);
    expect(halfUpDiv(8400, 100)).toBe(84);
    expect(toHundredths(42.5)).toBe(4250);
    expect(toHundredths(0.1 + 0.2)).toBe(30);
  });
});

describe('components', () => {
  it('only components with a maximum above 0 are marked', () => {
    expect(componentsOf(structure({ theoryMax: 80, practicalMax: 20 })).map((c) => c.key)).toEqual([
      'theory',
      'practical',
    ]);
    expect(componentsOf(structure({ theoryMax: 0, practicalMax: 50 })).map((c) => c.key)).toEqual([
      'practical',
    ]);
  });
  it('a subject is complete only when every component is entered ("-" is never 0)', () => {
    const s = structure({ theoryMax: 80, practicalMax: 20 });
    expect(isComplete(s, raw(65, null, null))).toBe(false);
    expect(scoreSubject(s, raw(65, null, null))).toBeNull();
    expect(isComplete(s, raw(0, null, 0))).toBe(true);
  });
});

describe('subject score', () => {
  it('Y/Z: normalisation 42/50 → 84/100 keeps the raw mark', () => {
    const score = scoreSubject(
      structure({ theoryMax: 50, passMarks: 18, normalizedMax: 100 }),
      raw(42),
    )!;
    expect(score).toMatchObject({
      totalCm: 4200,
      totalMax: 50,
      normalizedCm: 8400,
      finalCm: 8400,
      finalMax: 100,
      percentBp: 8400,
      grade: 'A',
      passed: true,
    });
  });
  it('normalisation works for any maximum and rounds half up (never truncates)', () => {
    // 37/70 → 52.857…/100 → 52.86
    const s = scoreSubject(structure({ theoryMax: 70, normalizedMax: 100 }), raw(37))!;
    expect(s.normalizedCm).toBe(5286);
    expect(s.percentBp).toBe(5286);
    // 33.5/40 → 41.875/50 → 41.88
    expect(
      scoreSubject(structure({ theoryMax: 40, normalizedMax: 50 }), raw(33.5))!.normalizedCm,
    ).toBe(4188);
  });
  it('components add up once: theory 65/80 + practical 18/20 = 83/100', () => {
    const s = scoreSubject(structure({ theoryMax: 80, practicalMax: 20 }), raw(65, null, 18))!;
    expect(s.totalCm).toBe(8300);
    expect(s.totalMax).toBe(100);
    expect(s.finalCm).toBe(8300);
  });
  it('AA: grade boundaries — 90 is A+, 89.99 is A, 0 gets the lowest grade', () => {
    expect(gradeForBp(SCALE.bands, 9000)).toBe('A+');
    expect(gradeForBp(SCALE.bands, 8999)).toBe('A');
    expect(gradeForBp(SCALE.bands, 10000)).toBe('A+');
    expect(gradeForBp(SCALE.bands, 0)).toBe('D');
    expect(scoreSubject(structure(), raw(90))!.grade).toBe('A+');
    expect(scoreSubject(structure({ gradeScale: null }), raw(90))!.grade).toBeNull();
  });
  it('AB: pass uses the configured pass marks against the raw total', () => {
    const s = structure({ theoryMax: 80, practicalMax: 20, passMarks: 40 });
    expect(scoreSubject(s, raw(30, null, 10))!.passed).toBe(true); // exactly 40
    expect(scoreSubject(s, raw(30, null, 9.5))!.passed).toBe(false);
    expect(scoreSubject(s, raw(0, null, 0))!.passed).toBe(false); // 0 is a real mark
    expect(scoreSubject(structure({ passMarks: 0 }), raw(0))!.passed).toBe(true);
  });
});

describe('exam summary and rank', () => {
  it('AG: percentage = total obtained ÷ total maximum (not an average of percentages)', () => {
    // Maths 84/100, Science 72/80, English 91/100 → 247/280 = 88.21 %
    const summary = summarizeExam([
      { finalCm: 8400, finalMax: 100, passed: true },
      { finalCm: 7200, finalMax: 80, passed: true },
      { finalCm: 9100, finalMax: 100, passed: true },
    ])!;
    expect(summary).toEqual({ totalCm: 24700, maxMarks: 280, percentBp: 8821, passed: true });
    // The average of 84 %, 90 % and 91 % would be 88.33 % — different on purpose.
    expect(summary.percentBp).not.toBe(8833);
    expect(summarizeExam([{ finalCm: 1000, finalMax: 100, passed: false }])!.passed).toBe(false);
    expect(summarizeExam([])).toBeNull();
  });
  it('competition rank: equal totals share a rank and the next rank is skipped', () => {
    const ranks = competitionRanks([
      { key: 'a', totalCm: 20000 },
      { key: 'b', totalCm: 25000 },
      { key: 'c', totalCm: 20000 },
      { key: 'd', totalCm: 10000 },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, a: 2, c: 2, d: 4 });
  });
});

describe('inputs', () => {
  const key = {
    examSubjectId: '00000000-0000-4000-8000-000000000001',
    sectionId: '00000000-0000-4000-8000-000000000002',
  };
  const row = (theory: unknown) => ({
    studentId: '00000000-0000-4000-8000-000000000003',
    theory,
    internal: null,
    practical: null,
  });
  it('Q: negative marks, more than two decimals and text are refused; blank and 0 are fine', () => {
    const parse = (theory: unknown) =>
      MarkSheetSaveSchema.safeParse({ ...key, revision: null, marks: [row(theory)] }).success;
    expect(parse(-1)).toBe(false);
    expect(parse(42.555)).toBe(false);
    expect(parse('42')).toBe(false);
    expect(parse(null)).toBe(true);
    expect(parse(0)).toBe(true);
    expect(parse(42.5)).toBe(true);
  });
  it('V: an unlock needs a real reason', () => {
    expect(MarkSheetUnlockSchema.safeParse({ ...key, revision: 2, reason: '' }).success).toBe(
      false,
    );
    expect(MarkSheetUnlockSchema.safeParse({ ...key, revision: 2, reason: 'typo' }).success).toBe(
      false,
    );
    expect(
      MarkSheetUnlockSchema.safeParse({ ...key, revision: 2, reason: 'Wrong mark for roll 4' })
        .success,
    ).toBe(true);
  });
});
