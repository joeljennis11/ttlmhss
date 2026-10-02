import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  HexColorSchema,
  IsoDateSchema,
  PaginationQuerySchema,
  TimeOfDaySchema,
  optionalText,
  requiredText,
  toFieldIssues,
} from '../src/index.js';

describe('validation building blocks', () => {
  it('requiredText trims and enforces presence and length', () => {
    const schema = requiredText(5, 'Name');
    expect(schema.parse('  Arun ')).toBe('Arun');
    expect(schema.safeParse('   ').success).toBe(false);
    expect(schema.safeParse('Arunkumar').success).toBe(false);
  });

  it('optionalText normalises empty input to null', () => {
    const schema = optionalText(10);
    expect(schema.parse('')).toBeNull();
    expect(schema.parse(undefined)).toBeNull();
    expect(schema.parse(' x ')).toBe('x');
  });

  it('IsoDateSchema accepts real dates only', () => {
    expect(IsoDateSchema.safeParse('2026-06-01').success).toBe(true);
    expect(IsoDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(IsoDateSchema.safeParse('01-06-2026').success).toBe(false);
    expect(IsoDateSchema.safeParse('2028-02-29').success).toBe(true);
  });

  it('TimeOfDaySchema uses 24-hour HH:MM', () => {
    expect(TimeOfDaySchema.safeParse('09:15').success).toBe(true);
    expect(TimeOfDaySchema.safeParse('23:59').success).toBe(true);
    expect(TimeOfDaySchema.safeParse('24:00').success).toBe(false);
    expect(TimeOfDaySchema.safeParse('9:15').success).toBe(false);
  });

  it('HexColorSchema validates and normalises the brand colour', () => {
    expect(HexColorSchema.parse('#003300')).toBe('#003300');
    expect(HexColorSchema.parse('#00ff00')).toBe('#00FF00');
    expect(HexColorSchema.safeParse('003300').success).toBe(false);
  });

  it('PaginationQuerySchema coerces query strings and caps page size', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(PaginationQuerySchema.parse({ page: '3', pageSize: '10' })).toEqual({
      page: 3,
      pageSize: 10,
    });
    expect(PaginationQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
  });

  it('toFieldIssues produces location-prefixed paths', () => {
    const result = z.object({ name: z.string() }).safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldIssues(result.error, 'body')).toEqual([
        { path: 'body.name', message: expect.any(String) },
      ]);
    }
  });
});
