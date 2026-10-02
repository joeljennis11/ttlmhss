import { describe, expect, it } from 'vitest';
import {
  AttendanceStatus,
  ATTENDANCE_STATUS_LABELS,
  BehaviourRatingSchema,
  EnrolmentStatus,
  PromotionOutcome,
  UserRole,
} from '../src/index.js';

describe('controlled values', () => {
  it('attendance statuses are exactly - P A L C', () => {
    expect(AttendanceStatus.values).toEqual(['-', 'P', 'A', 'L', 'C']);
    expect(Object.keys(ATTENDANCE_STATUS_LABELS).sort()).toEqual(
      [...AttendanceStatus.values].sort(),
    );
  });

  it('rejects arbitrary attendance status strings', () => {
    expect(AttendanceStatus.is('P')).toBe(true);
    expect(AttendanceStatus.is('AB')).toBe(false);
    expect(AttendanceStatus.is('p')).toBe(false);
    expect(AttendanceStatus.schema.safeParse('Present').success).toBe(false);
  });

  it('class teacher is not an account role', () => {
    expect(UserRole.values).toEqual(['ADMIN', 'TEACHER', 'STUDENT']);
  });

  it('every promotion outcome is a valid enrolment status', () => {
    for (const outcome of PromotionOutcome.values) {
      expect(EnrolmentStatus.is(outcome)).toBe(true);
    }
  });

  it('behaviour ratings are integers 1–5', () => {
    expect(BehaviourRatingSchema.safeParse(1).success).toBe(true);
    expect(BehaviourRatingSchema.safeParse(5).success).toBe(true);
    expect(BehaviourRatingSchema.safeParse(0).success).toBe(false);
    expect(BehaviourRatingSchema.safeParse(6).success).toBe(false);
    expect(BehaviourRatingSchema.safeParse(3.5).success).toBe(false);
  });
});
