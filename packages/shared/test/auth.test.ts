import { describe, expect, it } from 'vitest';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  PERMISSIONS,
  isPermission,
  passwordPolicyProblems,
} from '../src/index.js';

describe('password policy', () => {
  it('accepts a reasonable password', () => {
    expect(passwordPolicyProblems('river stone 42')).toEqual([]);
  });

  it.each([
    ['short1', /at least 8/],
    ['onlyletters', /letter and one number/],
    ['1234567890', /letter and one number/],
    ['password123', /too common/],
    [' padded123 ', /space/],
  ])('rejects %j', (password, problem) => {
    expect(passwordPolicyProblems(password).join('; ')).toMatch(problem);
  });

  it('rejects passwords containing the username', () => {
    expect(passwordPolicyProblems('arun2026x', 'arun').join()).toMatch(/username/);
  });
});

describe('auth request schemas', () => {
  it('normalises the username and keeps the password exactly as typed', () => {
    expect(LoginRequestSchema.parse({ username: '  Admin.One ', password: ' p w ' })).toEqual({
      username: 'admin.one',
      password: ' p w ',
    });
  });

  it('rejects malformed login input', () => {
    expect(LoginRequestSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ username: 'a b', password: 'x' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ username: 'a', password: 'x'.repeat(129) }).success).toBe(
      false,
    );
    expect(LoginRequestSchema.safeParse({ username: 'a' }).success).toBe(false);
  });

  it('change-password requires policy, confirmation and a different password', () => {
    const ok = ChangePasswordRequestSchema.safeParse({
      currentPassword: 'Temp1234',
      newPassword: 'river stone 42',
      confirmPassword: 'river stone 42',
    });
    expect(ok.success).toBe(true);

    const bad = ChangePasswordRequestSchema.safeParse({
      currentPassword: 'river stone 42',
      newPassword: 'river stone 42',
      confirmPassword: 'river stone 43',
    });
    expect(bad.success).toBe(false);
    const messages = bad.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('Passwords do not match');
    expect(messages).toContain('New password must be different from the current one');
  });
});

describe('permission catalogue', () => {
  it('keys are unique resource.action strings', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const key of PERMISSIONS) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    expect(isPermission('students.view')).toBe(true);
    expect(isPermission('students.destroy')).toBe(false);
  });
});
