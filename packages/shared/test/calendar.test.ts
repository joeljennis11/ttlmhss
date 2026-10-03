import { describe, expect, it } from 'vitest';
import {
  CalendarEntryInputSchema,
  classesInRange,
  resolveWorkingDay,
  targetsOverlap,
  type CalendarEntryFacts,
} from '../src/index.js';

/*
 * Phase 8A — the calendar rule in isolation. Synthetic classes in the school's real shape:
 * PreKG, LKG, UKG, 1 … 12 ordered by display order (names are NOT compared as strings).
 */
const NAMES = [
  'PreKG',
  'LKG',
  'UKG',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
];
const CLASSES = NAMES.map((name, i) => ({ id: `c-${name}`, name, displayOrder: i + 1 }));
const cls = (name: string) => `c-${name}`;
const sec = (name: string, s = 'A') => `s-${name}-${s}`;
const classOf = (sectionId: string) => `c-${sectionId.split('-')[1]}`;

const YEAR = {
  startDate: '2026-06-01',
  endDate: '2027-04-30',
  workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const,
};
// 2026-10-05 Mon · 2026-10-02 Fri · 2026-10-17 Sat · 2026-10-18 Sun
const entry = (e: Partial<CalendarEntryFacts> & Pick<CalendarEntryFacts, 'date' | 'status'>) =>
  ({
    id: `e-${e.date}-${e.scope ?? 'SCHOOL'}`,
    scope: 'SCHOOL',
    classIds: [],
    sectionIds: [],
    reason: 'Test',
    ...e,
  }) as CalendarEntryFacts;
const working = (entries: CalendarEntryFacts[], date: string, className: string, s = 'A') =>
  resolveWorkingDay(YEAR, entries, date, cls(className), sec(className, s)).working;

describe('class ranges use the configured order, not names', () => {
  it('10–12 is 10, 11, 12 (not "10", "11", "12", "2" … by string)', () => {
    expect(classesInRange(CLASSES, cls('10'), cls('12')).map((c) => c.name)).toEqual([
      '10',
      '11',
      '12',
    ]);
  });
  it('PreKG–UKG and UKG–2 include the pre-primary classes correctly; either end may come first', () => {
    expect(classesInRange(CLASSES, cls('PreKG'), cls('UKG')).map((c) => c.name)).toEqual([
      'PreKG',
      'LKG',
      'UKG',
    ]);
    expect(classesInRange(CLASSES, cls('2'), cls('UKG')).map((c) => c.name)).toEqual([
      'UKG',
      '1',
      '2',
    ]);
    expect(classesInRange(CLASSES, cls('1'), cls('10'))).toHaveLength(10);
    expect(classesInRange(CLASSES, cls('1'), 'missing')).toEqual([]);
  });
});

describe('resolution: weekly pattern → date entry → class/section', () => {
  it('A. weekly default: Monday working, Sunday not; outside the year never', () => {
    expect(working([], '2026-10-05', '5')).toBe(true);
    expect(working([], '2026-10-18', '5')).toBe(false);
    const outside = resolveWorkingDay(YEAR, [], '2027-05-03', cls('5'), sec('5'));
    expect(outside).toMatchObject({ inYear: false, working: false, source: 'OUTSIDE_YEAR' });
  });

  it('B. whole-school holiday turns a working day off for every class', () => {
    const e = [entry({ date: '2026-10-02', status: 'HOLIDAY', reason: 'Gandhi Jayanti' })];
    for (const n of NAMES) expect(working(e, '2026-10-02', n)).toBe(false);
    expect(resolveWorkingDay(YEAR, e, '2026-10-02', cls('1'), sec('1'))).toMatchObject({
      source: 'ENTRY',
      entry: { status: 'HOLIDAY', reason: 'Gandhi Jayanti' },
    });
    expect(working(e, '2026-10-05', '1')).toBe(true);
  });

  it('C. class holiday 1–10: 11 and 12 keep working', () => {
    const ids = classesInRange(CLASSES, cls('1'), cls('10')).map((c) => c.id);
    const e = [entry({ date: '2026-10-14', status: 'HOLIDAY', scope: 'CLASSES', classIds: ids })];
    expect(working(e, '2026-10-14', '1')).toBe(false);
    expect(working(e, '2026-10-14', '10')).toBe(false);
    expect(working(e, '2026-10-14', '11')).toBe(true);
    expect(working(e, '2026-10-14', '12')).toBe(true);
    expect(working(e, '2026-10-14', 'UKG')).toBe(true);
  });

  it('D/E. special working days: Saturday for 11–12, Sunday for 12 only', () => {
    const e = [
      entry({
        date: '2026-10-17',
        status: 'WORKING',
        scope: 'CLASSES',
        classIds: [cls('11'), cls('12')],
      }),
      entry({ date: '2026-10-18', status: 'WORKING', scope: 'CLASSES', classIds: [cls('12')] }),
    ];
    expect(working(e, '2026-10-17', '11')).toBe(true);
    expect(working(e, '2026-10-17', '12')).toBe(true);
    expect(working(e, '2026-10-17', '10')).toBe(false);
    expect(working(e, '2026-10-18', '12')).toBe(true);
    expect(working(e, '2026-10-18', '11')).toBe(false);
    // Other Saturdays keep the weekly pattern.
    expect(working(e, '2026-10-24', '12')).toBe(false);
  });

  it('section entries: 10 A only', () => {
    const e = [
      entry({ date: '2026-10-07', status: 'HOLIDAY', scope: 'SECTIONS', sectionIds: [sec('10')] }),
    ];
    expect(working(e, '2026-10-07', '10', 'A')).toBe(false);
    expect(working(e, '2026-10-07', '10', 'B')).toBe(true);
  });

  it('I. different classes on the same date resolve independently', () => {
    const e = [
      entry({ date: '2026-10-16', status: 'HOLIDAY', scope: 'CLASSES', classIds: [cls('10')] }),
    ];
    expect(working(e, '2026-10-16', '10')).toBe(false);
    expect(working(e, '2026-10-16', '11')).toBe(true);
  });
});

describe('overlap rule (entries never stack)', () => {
  const T = (scope: 'SCHOOL' | 'CLASSES' | 'SECTIONS', ids: string[] = []) => ({
    scope,
    classIds: scope === 'CLASSES' ? ids : [],
    sectionIds: scope === 'SECTIONS' ? ids : [],
  });
  it('the whole school overlaps everything', () => {
    expect(targetsOverlap(T('SCHOOL'), T('CLASSES', [cls('11')]), classOf)).toBe(true);
    expect(targetsOverlap(T('SECTIONS', [sec('10')]), T('SCHOOL'), classOf)).toBe(true);
  });
  it('classes overlap when they share a class; a class overlaps its own sections only', () => {
    expect(
      targetsOverlap(T('CLASSES', [cls('10'), cls('11')]), T('CLASSES', [cls('11')]), classOf),
    ).toBe(true);
    expect(targetsOverlap(T('CLASSES', [cls('10')]), T('CLASSES', [cls('11')]), classOf)).toBe(
      false,
    );
    expect(
      targetsOverlap(T('CLASSES', [cls('10')]), T('SECTIONS', [sec('10', 'B')]), classOf),
    ).toBe(true);
    expect(targetsOverlap(T('SECTIONS', [sec('11')]), T('CLASSES', [cls('10')]), classOf)).toBe(
      false,
    );
    expect(
      targetsOverlap(T('SECTIONS', [sec('10', 'A')]), T('SECTIONS', [sec('10', 'B')]), classOf),
    ).toBe(false);
  });
});

describe('entry input', () => {
  const base = { date: '2026-10-02', status: 'HOLIDAY', reason: 'Gandhi Jayanti' };
  it('needs the right targets for its scope and a reason', () => {
    expect(CalendarEntryInputSchema.safeParse({ ...base, scope: 'SCHOOL' }).success).toBe(true);
    expect(CalendarEntryInputSchema.safeParse({ ...base, scope: 'CLASSES' }).success).toBe(false);
    expect(
      CalendarEntryInputSchema.safeParse({
        ...base,
        scope: 'SCHOOL',
        classIds: ['00000000-0000-4000-8000-000000000001'],
      }).success,
    ).toBe(false);
    expect(
      CalendarEntryInputSchema.safeParse({ ...base, scope: 'SCHOOL', reason: ' ' }).success,
    ).toBe(false);
    expect(
      CalendarEntryInputSchema.safeParse({ ...base, scope: 'SCHOOL', date: '2026-02-30' }).success,
    ).toBe(false);
  });
});
