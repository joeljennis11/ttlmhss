import { createHmac, randomBytes, randomInt } from 'node:crypto';

/**
 * Session tokens: 256 random bits, base64url (43 chars). The raw token only ever exists in the
 * client's HttpOnly cookie; the database stores HMAC-SHA256(SESSION_SECRET, token).
 */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function isWellFormedSessionToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Temporary passwords issued by the system (new accounts, resets). 12 characters from an
 * alphabet without look-alikes (no 0/O, 1/l/I), always containing letters and digits so they
 * satisfy the password policy. Generated with a CSPRNG.
 */
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALPHABET = LETTERS + DIGITS;

export function generateTemporaryPassword(length = 12): string {
  const chars = [
    LETTERS[randomInt(LETTERS.length)]!,
    DIGITS[randomInt(DIGITS.length)]!,
    ...Array.from({ length: length - 2 }, () => ALPHABET[randomInt(ALPHABET.length)]!),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
